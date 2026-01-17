/**
 * VoiceScribe AI - Main Application Logic
 * 録音履歴リスト形式のモダンなAI文字起こしPWA
 * 
 * Transformers.js (Whisper) を使用したローカル音声認識
 * すべての処理はローカルで実行、外部へのデータ送信なし
 */

const elements = {
    homeView: document.getElementById('homeView'),
    recordBtn: document.getElementById('recordBtn'),
    recordIcon: document.getElementById('recordIcon'),
    pulseRings: document.getElementById('pulseRings'),
    statusDot: document.getElementById('statusDot'),
    statusText: document.getElementById('statusText'),
    historyList: document.getElementById('historyList'),
    historyCount: document.getElementById('historyCount'),
    emptyHistory: document.getElementById('emptyHistory'),
    detailView: document.getElementById('detailView'),
    backBtn: document.getElementById('backBtn'),
    detailTitle: document.getElementById('detailTitle'),
    detailDate: document.getElementById('detailDate'),
    detailFullText: document.getElementById('detailFullText'),
    deleteCurrentBtn: document.getElementById('deleteCurrentBtn'),
    detailCopyBtn: document.getElementById('detailCopyBtn'),
    detailSaveBtn: document.getElementById('detailSaveBtn'),
    openSettingsBtn: document.getElementById('openSettingsBtn'),
    keywordBadge: document.getElementById('keywordBadge'),
    bottomSheet: document.getElementById('bottomSheet'),
    bottomSheetOverlay: document.getElementById('bottomSheetOverlay'),
    closeSheetBtn: document.getElementById('closeSheetBtn'),
    keywordList: document.getElementById('keywordList'),
    emptyKeywords: document.getElementById('emptyKeywords'),
    keywordInput: document.getElementById('keywordInput'),
    addKeywordBtn: document.getElementById('addKeywordBtn'),
    toast: document.getElementById('toast'),
    toastIcon: document.getElementById('toastIcon'),
    toastMessage: document.getElementById('toastMessage'),
};

let state = {
    currentView: 'home',
    currentTranscriptionId: null,
    isRecording: false,
    isProcessing: false,
    transcriptions: [],
    keywords: [],
    worker: null,
    mediaRecorder: null,
    audioChunks: [],
};

const STORAGE_KEYS = {
    TRANSCRIPTIONS: 'transcriptions_v1',
    KEYWORDS: 'voicescribe_keywords',
};
const TARGET_SAMPLE_RATE = 16000;
const PREVIEW_LENGTH = 30;

function init() {
    loadTranscriptions();
    loadKeywords();
    setupEventListeners();
    initializeWorker();
    renderHistoryList();
    updateKeywordBadge();
}

function setupEventListeners() {
    elements.recordBtn.addEventListener('click', toggleRecording);
    elements.backBtn.addEventListener('click', navigateToHome);
    elements.detailCopyBtn.addEventListener('click', copyCurrentTranscription);
    elements.detailSaveBtn.addEventListener('click', saveCurrentTranscription);
    elements.deleteCurrentBtn.addEventListener('click', deleteCurrentTranscription);
    elements.openSettingsBtn.addEventListener('click', openBottomSheet);
    elements.closeSheetBtn.addEventListener('click', closeBottomSheet);
    elements.bottomSheetOverlay.addEventListener('click', closeBottomSheet);
    elements.addKeywordBtn.addEventListener('click', addKeyword);
    elements.keywordInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') addKeyword();
    });
    window.addEventListener('popstate', (e) => {
        if (state.currentView === 'detail') {
            e.preventDefault();
            navigateToHome();
        }
    });
}

function initializeWorker() {
    try {
        state.worker = new Worker('worker.js', { type: 'module' });
        state.worker.onmessage = handleWorkerMessage;
        state.worker.onerror = (error) => {
            console.error('Worker error:', error);
            showToast('AIエンジンでエラーが発生しました', 'error');
            updateStatus('ready', 'タップして録音開始');
        };
    } catch (error) {
        console.error('Failed to initialize worker:', error);
        showToast('AIエンジンの初期化に失敗しました', 'error');
    }
}

function handleWorkerMessage(event) {
    const { type, status, message, percent, text } = event.data;

    switch (type) {
        case 'status':
            handleStatusUpdate(status, message);
            break;
        case 'progress':
            updateStatus('loading', message || `読込中: ${percent}%`);
            break;
        case 'result':
            handleTranscriptionResult(text);
            break;
        case 'error':
            state.isProcessing = false;
            showToast(message || 'エラーが発生しました', 'error');
            updateStatus('ready', 'タップして録音開始');
            break;
    }
}

function handleStatusUpdate(status, message) {
    switch (status) {
        case 'loading':
            updateStatus('loading', message || 'モデル読込中...');
            break;
        case 'ready':
            if (!state.isRecording && !state.isProcessing) {
                updateStatus('ready', 'タップして録音開始');
            }
            break;
        case 'transcribing':
            state.isProcessing = true;
            updateStatus('processing', message || '認識中...');
            break;
    }
}

function handleTranscriptionResult(text) {
    state.isProcessing = false;

    if (text && text.trim()) {
        const processedText = processKeywords(text.trim());
        const newTranscription = createTranscription(processedText);
        state.transcriptions.unshift(newTranscription);
        saveTranscriptions();
        renderHistoryList();
        navigateToDetail(newTranscription.id);
        showToast('認識が完了しました', 'success');
    } else {
        showToast('音声を認識できませんでした', 'warning');
    }

    updateStatus('ready', 'タップして録音開始');
}

function updateStatus(status, message) {
    elements.statusText.textContent = message;
    const dot = elements.statusDot;
    dot.classList.remove('listening', 'processing');

    switch (status) {
        case 'recording':
            dot.style.backgroundColor = '#ef4444';
            dot.style.boxShadow = '0 10px 15px -3px rgba(239, 68, 68, 0.5)';
            dot.classList.add('listening');
            break;
        case 'loading':
        case 'processing':
            dot.style.backgroundColor = '#f59e0b';
            dot.style.boxShadow = '0 10px 15px -3px rgba(245, 158, 11, 0.5)';
            dot.classList.add('processing');
            break;
        case 'ready':
        default:
            dot.style.backgroundColor = '#34d399';
            dot.style.boxShadow = '0 10px 15px -3px rgba(52, 211, 153, 0.5)';
            break;
    }
}

function navigateToHome() {
    state.currentView = 'home';
    state.currentTranscriptionId = null;
    elements.detailView.classList.add('translate-x-full');
    document.body.style.overflow = '';
}

function navigateToDetail(id) {
    const transcription = state.transcriptions.find(t => t.id === id);
    if (!transcription) return;

    state.currentView = 'detail';
    state.currentTranscriptionId = id;
    elements.detailDate.textContent = transcription.date;
    elements.detailFullText.textContent = transcription.fullText;
    elements.detailView.classList.remove('translate-x-full');
    document.body.style.overflow = 'hidden';
    history.pushState({ view: 'detail', id }, '', `#detail-${id}`);
}

async function toggleRecording() {
    if (state.isProcessing) {
        showToast('処理中です...', 'warning');
        return;
    }

    if (state.isRecording) {
        stopRecording();
    } else {
        await startRecording();
    }
}

async function startRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                channelCount: 1,
                sampleRate: 48000,
                echoCancellation: true,
                noiseSuppression: true,
            }
        });

        state.audioChunks = [];

        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
            ? 'audio/webm;codecs=opus'
            : 'audio/webm';

        state.mediaRecorder = new MediaRecorder(stream, { mimeType });

        state.mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                state.audioChunks.push(event.data);
            }
        };

        state.mediaRecorder.onstop = async () => {
            stream.getTracks().forEach(track => track.stop());
            await processAudioData();
        };

        state.mediaRecorder.start(1000);
        state.isRecording = true;

        elements.recordBtn.classList.add('recording');
        elements.recordIcon.classList.remove('ph-microphone');
        elements.recordIcon.classList.add('ph-stop');
        elements.pulseRings.classList.remove('hidden');
        updateStatus('recording', '録音中... タップで停止');
        showToast('録音を開始しました', 'success');

    } catch (error) {
        console.error('Failed to start recording:', error);
        if (error.name === 'NotAllowedError') {
            showToast('マイクへのアクセスが拒否されました', 'error');
        } else {
            showToast('録音の開始に失敗しました', 'error');
        }
    }
}

function stopRecording() {
    if (state.mediaRecorder && state.isRecording) {
        state.mediaRecorder.stop();
        state.isRecording = false;

        elements.recordBtn.classList.remove('recording');
        elements.recordIcon.classList.remove('ph-stop');
        elements.recordIcon.classList.add('ph-microphone');
        elements.pulseRings.classList.add('hidden');
        showToast('録音を停止しました', 'info');
    }
}

async function processAudioData() {
    if (state.audioChunks.length === 0) {
        showToast('音声データがありません', 'warning');
        updateStatus('ready', 'タップして録音開始');
        return;
    }

    state.isProcessing = true;
    updateStatus('processing', '音声データを処理中...');

    try {
        const audioBlob = new Blob(state.audioChunks, { type: 'audio/webm' });
        const arrayBuffer = await audioBlob.arrayBuffer();

        // デコード用のAudioContext（デバイスのデフォルトサンプルレートで作成）
        const decodeContext = new (window.AudioContext || window.webkitAudioContext)();
        const originalBuffer = await decodeContext.decodeAudioData(arrayBuffer);
        await decodeContext.close();

        // 高品質リサンプリング（OfflineAudioContext使用）
        const pcmData = await resampleTo16kHzMono(originalBuffer);

        // 音声データの検証
        if (!pcmData || pcmData.length === 0) {
            throw new Error('音声データの変換に失敗しました');
        }

        // 無音チェック（RMSが閾値以下なら警告）
        const rms = calculateRMS(pcmData);
        if (rms < 0.001) {
            showToast('音声が検出されませんでした', 'warning');
            state.isProcessing = false;
            updateStatus('ready', 'タップして録音開始');
            return;
        }

        const keywordPrompt = state.keywords.map(k => k.word).join(', ');

        state.worker.postMessage({
            type: 'transcribe',
            audioData: pcmData,
            keywords: keywordPrompt
        });

    } catch (error) {
        console.error('Audio processing failed:', error);
        showToast('音声データの処理に失敗しました', 'error');
        state.isProcessing = false;
        updateStatus('ready', 'タップして録音開始');
    }
}

/**
 * OfflineAudioContextを使用した高品質リサンプリング
 * どのデバイス（PC/スマホ、44.1kHz/48kHz等）からも確実に16kHzモノラルに変換
 */
async function resampleTo16kHzMono(audioBuffer) {
    const sourceSampleRate = audioBuffer.sampleRate;
    const sourceLength = audioBuffer.length;
    const sourceDuration = audioBuffer.duration;
    const numChannels = audioBuffer.numberOfChannels;

    // ターゲット長を計算
    const targetLength = Math.round(sourceDuration * TARGET_SAMPLE_RATE);

    // OfflineAudioContextで16kHzモノラルにリサンプリング
    const offlineContext = new OfflineAudioContext(1, targetLength, TARGET_SAMPLE_RATE);

    // ソースバッファを作成
    const source = offlineContext.createBufferSource();
    source.buffer = audioBuffer;

    // モノラル化のためのチャンネルマージャー/ミキサー
    if (numChannels > 1) {
        const merger = offlineContext.createChannelMerger(1);
        const splitter = offlineContext.createChannelSplitter(numChannels);
        const gainNode = offlineContext.createGain();
        gainNode.gain.value = 1 / numChannels;

        source.connect(splitter);
        for (let i = 0; i < numChannels; i++) {
            splitter.connect(gainNode, i);
        }
        gainNode.connect(offlineContext.destination);
    } else {
        source.connect(offlineContext.destination);
    }

    source.start(0);

    // レンダリング実行
    const renderedBuffer = await offlineContext.startRendering();

    // Float32Arrayとして取得
    const pcmData = renderedBuffer.getChannelData(0);

    // 正規化（-1.0 〜 1.0 の範囲に収める）
    return normalizeAudio(pcmData);
}

/**
 * 音声データの正規化
 * クリッピングを防ぎつつ、適切な音量レベルに調整
 */
function normalizeAudio(audioData) {
    const maxAmplitude = Math.max(...audioData.map(Math.abs));

    // 既に適切な範囲内ならそのまま返す
    if (maxAmplitude <= 1.0 && maxAmplitude >= 0.1) {
        return audioData;
    }

    // 無音に近い場合はそのまま返す
    if (maxAmplitude < 0.001) {
        return audioData;
    }

    // 正規化（最大振幅を0.95に）
    const targetMax = 0.95;
    const scale = targetMax / maxAmplitude;
    const normalized = new Float32Array(audioData.length);

    for (let i = 0; i < audioData.length; i++) {
        normalized[i] = audioData[i] * scale;
    }

    return normalized;
}

/**
 * RMS（二乗平均平方根）を計算
 * 音声の全体的な音量レベルを測定
 */
function calculateRMS(audioData) {
    let sum = 0;
    for (let i = 0; i < audioData.length; i++) {
        sum += audioData[i] * audioData[i];
    }
    return Math.sqrt(sum / audioData.length);
}

function createTranscription(text) {
    const now = new Date();
    const id = `ts_${now.getTime()}`;
    const date = formatDate(now);
    const preview = text.length > PREVIEW_LENGTH
        ? text.substring(0, PREVIEW_LENGTH) + '...'
        : text;

    return { id, date, preview, fullText: text };
}

function loadTranscriptions() {
    try {
        const stored = localStorage.getItem(STORAGE_KEYS.TRANSCRIPTIONS);
        state.transcriptions = stored ? JSON.parse(stored) : [];
    } catch (e) {
        console.error('Failed to load transcriptions:', e);
        state.transcriptions = [];
    }
}

function saveTranscriptions() {
    try {
        localStorage.setItem(STORAGE_KEYS.TRANSCRIPTIONS, JSON.stringify(state.transcriptions));
    } catch (e) {
        console.error('Failed to save transcriptions:', e);
        showToast('保存に失敗しました', 'error');
    }
}

function deleteTranscription(id) {
    const index = state.transcriptions.findIndex(t => t.id === id);
    if (index === -1) return;

    state.transcriptions.splice(index, 1);
    saveTranscriptions();
    renderHistoryList();
    showToast('削除しました', 'info');
}

function deleteCurrentTranscription() {
    if (!state.currentTranscriptionId) return;
    deleteTranscription(state.currentTranscriptionId);
    navigateToHome();
}

function renderHistoryList() {
    const count = state.transcriptions.length;
    elements.historyCount.textContent = `${count}件`;

    if (count === 0) {
        elements.historyList.innerHTML = '';
        elements.emptyHistory.classList.remove('hidden');
        return;
    }

    elements.emptyHistory.classList.add('hidden');

    elements.historyList.innerHTML = state.transcriptions.map((t, index) => `
        <div class="history-card fade-in" style="animation-delay: ${index * 30}ms" data-id="${t.id}">
            <div class="flex-1 min-w-0 cursor-pointer" onclick="navigateToDetail('${t.id}')">
                <p class="text-xs text-slate-400 mb-1">${escapeHtml(t.date)}</p>
                <p class="text-sm text-slate-700 truncate">${escapeHtml(t.preview)}</p>
            </div>
            <button 
                class="p-2 rounded-lg hover:bg-red-50 active:scale-95 transition-all duration-200 group flex-shrink-0"
                onclick="event.stopPropagation(); deleteTranscription('${t.id}')"
            >
                <i class="ph ph-trash text-lg text-slate-300 group-hover:text-red-500"></i>
            </button>
        </div>
    `).join('');
}

function copyCurrentTranscription() {
    const transcription = state.transcriptions.find(t => t.id === state.currentTranscriptionId);
    if (!transcription) return;

    navigator.clipboard.writeText(transcription.fullText)
        .then(() => showToast('コピーしました', 'success'))
        .catch(() => showToast('コピーに失敗しました', 'error'));
}

function saveCurrentTranscription() {
    const transcription = state.transcriptions.find(t => t.id === state.currentTranscriptionId);
    if (!transcription) return;

    const blob = new Blob([transcription.fullText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');

    const filename = `transcript_${transcription.date.replace(/[\/: ]/g, '_')}.txt`;

    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast(`${filename} を保存しました`, 'success');
}

function processKeywords(text) {
    let processed = text;
    state.keywords.forEach(keyword => {
        const regex = new RegExp(escapeRegExp(keyword.word), 'gi');
        processed = processed.replace(regex, keyword.word);
    });
    return processed;
}

function loadKeywords() {
    try {
        const stored = localStorage.getItem(STORAGE_KEYS.KEYWORDS);
        state.keywords = stored ? JSON.parse(stored) : [];
    } catch (e) {
        state.keywords = [];
    }
}

function saveKeywords() {
    localStorage.setItem(STORAGE_KEYS.KEYWORDS, JSON.stringify(state.keywords));
}

function updateKeywordBadge() {
    elements.keywordBadge.textContent = state.keywords.length;
    elements.keywordBadge.classList.toggle('hidden', state.keywords.length === 0);
}

function addKeyword() {
    const input = elements.keywordInput.value.trim();
    if (!input) {
        showToast('キーワードを入力してください', 'warning');
        return;
    }

    if (state.keywords.some(k => k.word.toLowerCase() === input.toLowerCase())) {
        showToast('既に登録されています', 'warning');
        return;
    }

    state.keywords.push({ id: Date.now(), word: input });
    saveKeywords();
    renderKeywordList();
    updateKeywordBadge();

    elements.keywordInput.value = '';
    showToast(`「${input}」を追加しました`, 'success');
}

function deleteKeyword(id) {
    state.keywords = state.keywords.filter(k => k.id !== id);
    saveKeywords();
    renderKeywordList();
    updateKeywordBadge();
}

function renderKeywordList() {
    if (state.keywords.length === 0) {
        elements.keywordList.innerHTML = '';
        elements.emptyKeywords.classList.remove('hidden');
        return;
    }

    elements.emptyKeywords.classList.add('hidden');

    elements.keywordList.innerHTML = state.keywords.map((k, i) => `
        <div class="keyword-card fade-in" style="animation-delay: ${i * 50}ms">
            <span class="keyword-text">${escapeHtml(k.word)}</span>
            <button class="keyword-delete-btn" onclick="deleteKeyword(${k.id})">
                <i class="ph ph-trash text-lg"></i>
            </button>
        </div>
    `).join('');
}

function openBottomSheet() {
    renderKeywordList();
    elements.bottomSheet.classList.add('open');
    elements.bottomSheetOverlay.classList.add('open');
    document.body.style.overflow = 'hidden';
}

function closeBottomSheet() {
    elements.bottomSheet.classList.remove('open');
    elements.bottomSheetOverlay.classList.remove('open');
    if (state.currentView === 'home') {
        document.body.style.overflow = '';
    }
}

function showToast(message, type = 'info') {
    const iconMap = {
        success: 'ph-check-circle',
        error: 'ph-x-circle',
        warning: 'ph-warning-circle',
        info: 'ph-info',
    };
    const colorMap = {
        success: 'text-emerald-400',
        error: 'text-red-400',
        warning: 'text-amber-400',
        info: 'text-blue-400',
    };

    elements.toastIcon.className = `ph ${iconMap[type]} text-lg ${colorMap[type]}`;
    elements.toastMessage.textContent = message;
    elements.toast.classList.add('show');

    setTimeout(() => elements.toast.classList.remove('show'), 2500);
}

function formatDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    return `${y}/${m}/${d} ${h}:${min}`;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(() => { });
    });
}

document.addEventListener('DOMContentLoaded', init);

window.navigateToDetail = navigateToDetail;
window.deleteTranscription = deleteTranscription;
window.deleteKeyword = deleteKeyword;
