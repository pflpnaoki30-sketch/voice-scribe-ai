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
    // Volume Meter
    volumeMeterContainer: document.getElementById('volumeMeterContainer'),
    volumeMeter: document.getElementById('volumeMeter'),
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
    // Audio analysis
    audioContext: null,
    analyser: null,
    volumeAnimationId: null,
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
        // 鉄壁のフィルタリング
        let cleaned = cleanText(text.trim());

        // クリーン後にテキストが残っているか確認
        if (!cleaned) {
            showToast('有効な音声を認識できませんでした', 'warning');
            updateStatus('ready', 'タップして録音開始');
            return;
        }

        const processedText = processKeywords(cleaned);
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

/**
 * cleanText - 鉄壁のテキストフィルタリング
 * ハルシネーション、ループ、ノイズを完全除去
 */
function cleanText(text) {
    if (!text) return '';

    let cleaned = text;

    // ========================================
    // 1. ループ検出（同じフレーズが3回以上連続→全体破棄）
    // ========================================
    if (hasRepetitionLoop(cleaned)) {
        return '';
    }

    // ========================================
    // 2. 記号/数字の羅列削除
    // ========================================
    cleaned = cleaned.replace(/[\d\.]{4,}/g, '');            // 8.8.8., 1234 等
    cleaned = cleaned.replace(/[\.]{2,}/g, '');              // ....
    cleaned = cleaned.replace(/[。]{2,}/g, '。');            // 。。→。
    cleaned = cleaned.replace(/[、]{2,}/g, '、');            // 、、→、
    cleaned = cleaned.replace(/[…]{2,}/g, '…');              // ……→…
    cleaned = cleaned.replace(/[\s]{2,}/g, ' ');             // 連続空白→単一

    // ========================================
    // 3. ブラックリスト（Whisper特有の幻覚ワード）
    // ========================================
    const blacklistWords = [
        'ご視聴ありがとうございました',
        '視聴ありがとうございました',
        'ありがとうございました',
        'お疲れ様でした',
        'お疲れさまでした',
        'チャンネル登録',
        '高評価',
        'いいね',
        '字幕',
        'サブタイトル',
        '翻訳',
        'Translated by',
        'Subtitles by',
        'Transcribed by',
        'Amara.org',
    ];

    for (const word of blacklistWords) {
        if (cleaned.includes(word)) {
            // ブラックリストワードを含む文を削除
            const sentences = cleaned.split(/[。\.!\?！？]/);
            cleaned = sentences
                .filter(s => !s.includes(word))
                .join('。')
                .replace(/^。+|。+$/g, '');
        }
    }

    // ブラックリストワードだけで構成されている場合は破棄
    const blacklistOnlyPattern = new RegExp(
        `^[\\s]*(?:${blacklistWords.map(escapeRegExp).join('|')})[。、\\.\\s]*$`,
        'i'
    );
    if (blacklistOnlyPattern.test(cleaned)) {
        return '';
    }

    // ========================================
    // 4. 繰り返しフレーズの削除（軽度）
    // ========================================
    // 2文字以上が3回以上連続→1回に
    cleaned = cleaned.replace(/(.{2,15})\1{2,}/g, '$1');
    // 単語の繰り返し（スペース区切り）
    cleaned = cleaned.replace(/(\S+)[\s、]+\1([\s、]+\1)+/g, '$1');

    // ========================================
    // 5. 短すぎるノイズ（2文字以下のひらがな/カタカナ単体）
    // ========================================
    const noisePatterns = [
        /^[あ-んア-ン]{1,2}$/,               // ひらがな/カタカナ1-2文字
        /^[えあうお][ーっ]*$/,               // えー、あー、うー 等
        /^は[いぃ]*$/,                       // はい
        /^う[ん]*$/,                         // うん
        /^そう$/,                            // そう
        /^ね[ぇ]*$/,                         // ねー
        /^[笑泣汗]+$/,                       // 笑、泣 等
        /^\([^)]*\)$/,                       // (笑) 等
        /^[\s。、\.…]+$/,                    // 句読点のみ
    ];

    for (const pattern of noisePatterns) {
        if (pattern.test(cleaned.trim())) {
            return '';
        }
    }

    // ========================================
    // 6. 最終クリーンアップ
    // ========================================
    cleaned = cleaned.trim();
    cleaned = cleaned.replace(/^[、。\.…\s]+/, '');          // 先頭の句読点削除
    cleaned = cleaned.replace(/[、\s]+$/, '');               // 末尾の不要文字削除

    // 3文字未満は破棄
    if (cleaned.length < 3) {
        return '';
    }

    return cleaned;
}

/**
 * ループ検出
 * 同じフレーズが3回以上連続していたらtrue
 */
function hasRepetitionLoop(text) {
    if (!text || text.length < 6) return false;

    // 3文字〜20文字のフレーズが3回以上連続するパターン
    const loopPattern = /(.{3,20})\1{2,}/;
    if (loopPattern.test(text)) {
        // マッチした繰り返し部分が全体の50%以上を占めるなら破棄
        const match = text.match(loopPattern);
        if (match && match[0].length > text.length * 0.5) {
            return true;
        }
    }

    // 単語レベルのループ検出（「じゃあ、じゃあ、じゃあ」等）
    const words = text.split(/[、。\s]+/).filter(w => w.length > 0);
    if (words.length >= 3) {
        const wordCounts = {};
        for (const word of words) {
            wordCounts[word] = (wordCounts[word] || 0) + 1;
        }
        // 同じ単語が全体の70%以上を占める
        for (const count of Object.values(wordCounts)) {
            if (count >= 3 && count / words.length >= 0.7) {
                return true;
            }
        }
    }

    return false;
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

        // ボリュームメーター用のAudioContext & Analyserセットアップ
        state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        state.analyser = state.audioContext.createAnalyser();
        state.analyser.fftSize = 256;

        const source = state.audioContext.createMediaStreamSource(stream);
        source.connect(state.analyser);

        // ボリュームメーター表示開始
        elements.volumeMeterContainer.classList.remove('hidden');
        startVolumeMonitoring();

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
            stopVolumeMonitoring();
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

        // ボリュームメーター非表示
        stopVolumeMonitoring();
        elements.volumeMeterContainer.classList.add('hidden');

        showToast('録音を停止しました', 'info');
    }
}

/**
 * リアルタイム音量モニタリング開始
 */
function startVolumeMonitoring() {
    if (!state.analyser) return;

    const dataArray = new Uint8Array(state.analyser.frequencyBinCount);

    function updateMeter() {
        if (!state.isRecording) return;

        state.analyser.getByteFrequencyData(dataArray);

        // RMS計算（周波数データから音量を推定）
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
        }
        const average = sum / dataArray.length;

        // 0-100%に変換（感度調整）
        const volumePercent = Math.min(100, average * 1.5);

        // メーター更新
        elements.volumeMeter.style.width = `${volumePercent}%`;

        // 色の変更（音量に応じて緑→黄→赤）
        if (volumePercent > 80) {
            elements.volumeMeter.classList.remove('from-green-400', 'to-emerald-500', 'from-yellow-400', 'to-amber-500');
            elements.volumeMeter.classList.add('from-red-400', 'to-rose-500');
        } else if (volumePercent > 50) {
            elements.volumeMeter.classList.remove('from-green-400', 'to-emerald-500', 'from-red-400', 'to-rose-500');
            elements.volumeMeter.classList.add('from-yellow-400', 'to-amber-500');
        } else {
            elements.volumeMeter.classList.remove('from-yellow-400', 'to-amber-500', 'from-red-400', 'to-rose-500');
            elements.volumeMeter.classList.add('from-green-400', 'to-emerald-500');
        }

        state.volumeAnimationId = requestAnimationFrame(updateMeter);
    }

    updateMeter();
}

/**
 * 音量モニタリング停止
 */
function stopVolumeMonitoring() {
    if (state.volumeAnimationId) {
        cancelAnimationFrame(state.volumeAnimationId);
        state.volumeAnimationId = null;
    }

    if (state.audioContext) {
        state.audioContext.close().catch(() => { });
        state.audioContext = null;
        state.analyser = null;
    }

    // メーターをリセット
    if (elements.volumeMeter) {
        elements.volumeMeter.style.width = '0%';
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

        // Step 1: デコード用AudioContext（デバイスのデフォルトレートで作成）
        const decodeContext = new (window.AudioContext || window.webkitAudioContext)();
        const originalBuffer = await decodeContext.decodeAudioData(arrayBuffer);
        const originalSampleRate = originalBuffer.sampleRate;
        await decodeContext.close();

        // Step 2: 16kHzモノラルへリサンプリング
        let pcmData;
        try {
            // 方法1: OfflineAudioContextを使用（高品質）
            pcmData = await resampleWithOfflineContext(originalBuffer);
        } catch (offlineError) {
            console.warn('OfflineAudioContext failed, using fallback:', offlineError);
            // 方法2: 手動リサンプリング（フォールバック）
            pcmData = resampleManually(originalBuffer, TARGET_SAMPLE_RATE);
        }

        // Step 3: 音声データの検証
        if (!pcmData || pcmData.length === 0) {
            throw new Error('音声データの変換に失敗しました');
        }

        // Step 4: 無音チェック
        const rms = calculateRMS(pcmData);
        if (rms < 0.001) {
            showToast('音声が検出されませんでした', 'warning');
            state.isProcessing = false;
            updateStatus('ready', 'タップして録音開始');
            return;
        }

        // Step 5: 正規化
        pcmData = normalizeAudio(pcmData);

        // Step 6: Workerに送信
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
 * ブラウザのネイティブリサンプラーを使用
 */
async function resampleWithOfflineContext(audioBuffer) {
    const sourceDuration = audioBuffer.duration;
    const numChannels = audioBuffer.numberOfChannels;
    const targetLength = Math.round(sourceDuration * TARGET_SAMPLE_RATE);

    // OfflineAudioContextで16kHzモノラルにリサンプリング
    const offlineContext = new OfflineAudioContext(1, targetLength, TARGET_SAMPLE_RATE);

    // ソースバッファを作成
    const source = offlineContext.createBufferSource();
    source.buffer = audioBuffer;

    // ステレオ→モノラル変換
    if (numChannels > 1) {
        const splitter = offlineContext.createChannelSplitter(numChannels);
        const merger = offlineContext.createChannelMerger(1);
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

    const renderedBuffer = await offlineContext.startRendering();
    return new Float32Array(renderedBuffer.getChannelData(0));
}

/**
 * 手動リサンプリング（フォールバック用）
 * 線形補間を使用したダウンサンプリング
 */
function resampleManually(audioBuffer, targetSampleRate) {
    const sourceSampleRate = audioBuffer.sampleRate;
    const numChannels = audioBuffer.numberOfChannels;

    // Step 1: モノラル化
    let monoData;
    if (numChannels === 1) {
        monoData = new Float32Array(audioBuffer.getChannelData(0));
    } else {
        const ch0 = audioBuffer.getChannelData(0);
        const ch1 = audioBuffer.getChannelData(1);
        monoData = new Float32Array(ch0.length);
        for (let i = 0; i < ch0.length; i++) {
            monoData[i] = (ch0[i] + ch1[i]) / 2;
        }
    }

    // Step 2: サンプルレートが同じならそのまま返す
    if (sourceSampleRate === targetSampleRate) {
        return monoData;
    }

    // Step 3: リサンプリング（線形補間）
    const ratio = sourceSampleRate / targetSampleRate;
    const newLength = Math.floor(monoData.length / ratio);
    const result = new Float32Array(newLength);

    for (let i = 0; i < newLength; i++) {
        const srcIndex = i * ratio;
        const srcFloor = Math.floor(srcIndex);
        const srcCeil = Math.min(srcFloor + 1, monoData.length - 1);
        const fraction = srcIndex - srcFloor;

        // 線形補間
        result[i] = monoData[srcFloor] * (1 - fraction) + monoData[srcCeil] * fraction;
    }

    return result;
}

/**
 * 音声データの正規化
 * 最大振幅を0.95に調整してクリッピングを防止
 */
function normalizeAudio(audioData) {
    let maxAmp = 0;
    for (let i = 0; i < audioData.length; i++) {
        const abs = Math.abs(audioData[i]);
        if (abs > maxAmp) maxAmp = abs;
    }

    // 既に適切な範囲内
    if (maxAmp <= 1.0 && maxAmp >= 0.1) {
        return audioData;
    }

    // 無音に近い
    if (maxAmp < 0.001) {
        return audioData;
    }

    // 正規化
    const scale = 0.95 / maxAmp;
    const normalized = new Float32Array(audioData.length);
    for (let i = 0; i < audioData.length; i++) {
        normalized[i] = audioData[i] * scale;
    }

    return normalized;
}

/**
 * RMS（二乗平均平方根）を計算
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
