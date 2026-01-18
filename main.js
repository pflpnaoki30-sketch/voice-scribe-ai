/**
 * VoiceScribe AI - Main Application Logic
 * Groq API (Whisper-large-v3) を使用したAI文字起こしPWA
 * 
 * モバイル対応版 + キーワードプロンプト対応
 */

// ========================================
// DOM Elements
// ========================================
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
    volumeMeterContainer: document.getElementById('volumeMeterContainer'),
    volumeMeter: document.getElementById('volumeMeter'),
};

// ========================================
// Application State
// ========================================
let state = {
    currentView: 'home',
    currentTranscriptionId: null,
    isRecording: false,
    isProcessing: false,
    transcriptions: [],
    keywords: [],
    mediaRecorder: null,
    audioChunks: [],
    audioContext: null,
    analyser: null,
    volumeAnimationId: null,
    mediaStream: null,
};

// ========================================
// Constants
// ========================================
const STORAGE_KEYS = {
    TRANSCRIPTIONS: 'transcriptions_v1',
    KEYWORDS: 'voicescribe_keywords',
};
const PREVIEW_LENGTH = 30;
const API_ENDPOINT = '/api/transcribe';

// 幻覚フィルター用禁止ワード
const HALLUCINATION_WORDS = [
    'お疲れ様でした',
    'お疲れさまでした',
    'ご視聴ありがとうございました',
    '視聴ありがとうございました',
    'ありがとうございました',
    'チャンネル登録',
    '高評価',
    '字幕',
    'サブタイトル',
    'MBC',
    'IYH',
    'Translated by',
    'Subtitles by',
    'Amara.org',
];

// ========================================
// Initialization
// ========================================
function init() {
    loadTranscriptions();
    loadKeywords();
    setupEventListeners();
    renderHistoryList();
    updateKeywordBadge();
    updateStatus('ready', 'タップして録音開始');
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

// ========================================
// Recording Functions
// ========================================
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
        // マイクアクセス取得
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                channelCount: 1,
                sampleRate: 48000,
                echoCancellation: true,
                noiseSuppression: true,
            }
        });

        state.mediaStream = stream;
        state.audioChunks = [];

        // ========================================
        // モバイル対応：AudioContext初期化と強制起動
        // ========================================
        state.audioContext = new (window.AudioContext || window.webkitAudioContext)();

        // 重要：スマホでAudioContextがsuspendedの場合は強制resume
        if (state.audioContext.state === 'suspended') {
            await state.audioContext.resume();
        }

        // Analyserノード設定
        state.analyser = state.audioContext.createAnalyser();
        state.analyser.fftSize = 256;
        state.analyser.smoothingTimeConstant = 0.3;

        // マイク入力をAnalyserに接続
        const source = state.audioContext.createMediaStreamSource(stream);
        source.connect(state.analyser);

        // ボリュームメーター表示開始
        elements.volumeMeterContainer.classList.remove('hidden');
        startVolumeMonitoring();

        // MediaRecorder設定
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
            stopVolumeMonitoring();
            await processAudioData();
        };

        state.mediaRecorder.start(1000);
        state.isRecording = true;

        // UI更新
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

        // メディアストリーム停止
        if (state.mediaStream) {
            state.mediaStream.getTracks().forEach(track => track.stop());
            state.mediaStream = null;
        }

        // UI更新
        elements.recordBtn.classList.remove('recording');
        elements.recordIcon.classList.remove('ph-stop');
        elements.recordIcon.classList.add('ph-microphone');
        elements.pulseRings.classList.add('hidden');
        elements.volumeMeterContainer.classList.add('hidden');

        showToast('録音を停止しました', 'info');
    }
}

// ========================================
// Volume Meter (モバイル対応版)
// ========================================
function startVolumeMonitoring() {
    if (!state.analyser) return;

    const bufferLength = state.analyser.fftSize;
    const dataArray = new Uint8Array(bufferLength);

    function updateMeter() {
        if (!state.isRecording || !state.analyser) {
            return;
        }

        // TimeDomainDataで正確な音量検出
        state.analyser.getByteTimeDomainData(dataArray);

        // RMS計算
        let sumSquares = 0;
        for (let i = 0; i < bufferLength; i++) {
            const normalized = (dataArray[i] - 128) / 128;
            sumSquares += normalized * normalized;
        }
        const rms = Math.sqrt(sumSquares / bufferLength);

        // 感度4倍でパーセント変換（スマホ対応）
        const volumePercent = Math.min(100, rms * 400);

        // メーター更新
        if (elements.volumeMeter) {
            elements.volumeMeter.style.width = `${volumePercent}%`;

            // 色変更
            if (volumePercent > 70) {
                elements.volumeMeter.className = 'h-full rounded-full transition-all duration-75 bg-gradient-to-r from-red-400 to-rose-500';
            } else if (volumePercent > 40) {
                elements.volumeMeter.className = 'h-full rounded-full transition-all duration-75 bg-gradient-to-r from-yellow-400 to-amber-500';
            } else {
                elements.volumeMeter.className = 'h-full rounded-full transition-all duration-75 bg-gradient-to-r from-green-400 to-emerald-500';
            }
        }

        state.volumeAnimationId = requestAnimationFrame(updateMeter);
    }

    state.volumeAnimationId = requestAnimationFrame(updateMeter);
}

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

    if (elements.volumeMeter) {
        elements.volumeMeter.style.width = '0%';
    }
}

// ========================================
// Audio Processing & API Call
// ========================================
async function processAudioData() {
    if (state.audioChunks.length === 0) {
        showToast('音声データがありません', 'warning');
        updateStatus('ready', 'タップして録音開始');
        return;
    }

    state.isProcessing = true;
    updateStatus('processing', 'AIで文字起こし中...');

    try {
        // 録音データをBlobに変換
        const audioBlob = new Blob(state.audioChunks, { type: 'audio/webm' });

        // FormDataを作成
        const formData = new FormData();
        formData.append('audio', audioBlob, 'recording.webm');

        // ========================================
        // キーワードプロンプトを追加
        // ========================================
        const keywordPrompt = getKeywordPrompt();
        if (keywordPrompt) {
            formData.append('prompt', keywordPrompt);
        }

        // Groq API呼び出し
        const response = await fetch(API_ENDPOINT, {
            method: 'POST',
            body: formData,
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `API error: ${response.status}`);
        }

        const result = await response.json();

        if (result.success && result.text) {
            handleTranscriptionResult(result.text);
        } else {
            showToast('音声を認識できませんでした', 'warning');
            state.isProcessing = false;
            updateStatus('ready', 'タップして録音開始');
        }

    } catch (error) {
        console.error('Transcription failed:', error);
        showToast(`文字起こしに失敗しました: ${error.message}`, 'error');
        state.isProcessing = false;
        updateStatus('ready', 'タップして録音開始');
    }
}

/**
 * 登録済みキーワードをカンマ区切りのプロンプト文字列に変換
 */
function getKeywordPrompt() {
    // state.keywordsから取得（最も確実）
    if (state.keywords && state.keywords.length > 0) {
        return state.keywords.map(k => k.word).join(', ');
    }
    return '';
}

// ========================================
// Transcription Result Handler
// ========================================
function handleTranscriptionResult(text) {
    state.isProcessing = false;

    if (text && text.trim()) {
        // 幻覚フィルター適用
        const cleaned = filterHallucinations(text.trim());

        if (!cleaned) {
            showToast('音声が聞き取れませんでした', 'warning');
            updateStatus('ready', 'タップして録音開始');
            return;
        }

        // キーワード処理（大文字小文字統一）
        const processedText = processKeywords(cleaned);

        // 保存
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

// ========================================
// Hallucination Filter
// ========================================
function filterHallucinations(text) {
    if (!text) return '';

    let cleaned = text;

    // 繰り返しパターン検出（同じフレーズが3回以上）
    const loopPattern = /(.{3,20})\1{2,}/g;
    if (loopPattern.test(cleaned)) {
        const match = cleaned.match(loopPattern);
        if (match && match[0].length > cleaned.length * 0.5) {
            return '';
        }
        cleaned = cleaned.replace(loopPattern, '$1');
    }

    // 禁止ワードチェック（単独出現時は破棄）
    for (const word of HALLUCINATION_WORDS) {
        if (cleaned.trim() === word || cleaned.trim() === word + '。') {
            return '';
        }
    }

    // 禁止ワードを含む文を削除
    for (const word of HALLUCINATION_WORDS) {
        if (cleaned.includes(word)) {
            const sentences = cleaned.split(/[。\.！？!?]/);
            cleaned = sentences
                .filter(s => !s.includes(word))
                .join('。')
                .replace(/^。+|。+$/g, '');
        }
    }

    // 数字/記号の羅列削除
    cleaned = cleaned.replace(/[\d\.]{4,}/g, '');
    cleaned = cleaned.replace(/[\.]{2,}/g, '');
    cleaned = cleaned.replace(/[。]{2,}/g, '。');
    cleaned = cleaned.replace(/[\s]{2,}/g, ' ');

    // 短すぎるノイズ（2文字以下）
    if (cleaned.trim().length <= 2) {
        return '';
    }

    return cleaned.trim();
}

// ========================================
// Status & UI Updates
// ========================================
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

// ========================================
// Navigation
// ========================================
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

// ========================================
// Transcription CRUD
// ========================================
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
    }
}

function deleteCurrentTranscription() {
    if (!state.currentTranscriptionId) return;

    state.transcriptions = state.transcriptions.filter(t => t.id !== state.currentTranscriptionId);
    saveTranscriptions();
    renderHistoryList();
    navigateToHome();
    showToast('削除しました', 'success');
}

// ========================================
// History List Rendering
// ========================================
function renderHistoryList() {
    const count = state.transcriptions.length;
    elements.historyCount.textContent = count;

    if (count === 0) {
        elements.emptyHistory.classList.remove('hidden');
        elements.historyList.innerHTML = '';
        return;
    }

    elements.emptyHistory.classList.add('hidden');

    elements.historyList.innerHTML = state.transcriptions.map(t => `
        <div class="history-card p-4 rounded-2xl cursor-pointer" onclick="navigateToDetail('${t.id}')">
            <div class="flex items-start justify-between gap-3">
                <div class="flex-1 min-w-0">
                    <p class="text-sm text-slate-800 font-medium truncate">${escapeHtml(t.preview)}</p>
                    <p class="text-xs text-slate-400 mt-1">${t.date}</p>
                </div>
                <i class="ph ph-caret-right text-slate-400 text-lg flex-shrink-0"></i>
            </div>
        </div>
    `).join('');
}

// ========================================
// Detail Actions
// ========================================
async function copyCurrentTranscription() {
    const transcription = state.transcriptions.find(t => t.id === state.currentTranscriptionId);
    if (!transcription) return;

    try {
        await navigator.clipboard.writeText(transcription.fullText);
        showToast('コピーしました', 'success');
    } catch (e) {
        showToast('コピーに失敗しました', 'error');
    }
}

function saveCurrentTranscription() {
    const transcription = state.transcriptions.find(t => t.id === state.currentTranscriptionId);
    if (!transcription) return;

    const blob = new Blob([transcription.fullText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transcription_${transcription.id}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('保存しました', 'success');
}

// ========================================
// Keywords
// ========================================
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

function addKeyword() {
    const input = elements.keywordInput;
    const word = input.value.trim();
    if (!word) return;

    if (state.keywords.some(k => k.word === word)) {
        showToast('既に登録されています', 'warning');
        return;
    }

    state.keywords.push({ word, id: Date.now() });
    saveKeywords();
    renderKeywordList();
    updateKeywordBadge();
    input.value = '';
    showToast('キーワードを追加しました', 'success');
}

function removeKeyword(id) {
    state.keywords = state.keywords.filter(k => k.id !== id);
    saveKeywords();
    renderKeywordList();
    updateKeywordBadge();
}

function renderKeywordList() {
    if (state.keywords.length === 0) {
        elements.emptyKeywords.classList.remove('hidden');
        elements.keywordList.innerHTML = '';
        return;
    }

    elements.emptyKeywords.classList.add('hidden');

    elements.keywordList.innerHTML = state.keywords.map(k => `
        <div class="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
            <span class="text-sm text-slate-700">${escapeHtml(k.word)}</span>
            <button onclick="removeKeyword(${k.id})" class="p-1 hover:bg-slate-200 rounded-lg transition-colors">
                <i class="ph ph-x text-slate-400"></i>
            </button>
        </div>
    `).join('');
}

function updateKeywordBadge() {
    const count = state.keywords.length;
    if (count > 0) {
        elements.keywordBadge.textContent = count;
        elements.keywordBadge.classList.remove('hidden');
    } else {
        elements.keywordBadge.classList.add('hidden');
    }
}

/**
 * キーワード処理（認識結果に対して大文字小文字を統一）
 */
function processKeywords(text) {
    let processed = text;
    state.keywords.forEach(k => {
        const regex = new RegExp(escapeRegExp(k.word), 'gi');
        processed = processed.replace(regex, k.word);
    });
    return processed;
}

// ========================================
// Bottom Sheet
// ========================================
function openBottomSheet() {
    renderKeywordList();
    elements.bottomSheet.classList.remove('translate-y-full');
    elements.bottomSheetOverlay.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
}

function closeBottomSheet() {
    elements.bottomSheet.classList.add('translate-y-full');
    elements.bottomSheetOverlay.classList.add('hidden');
    document.body.style.overflow = '';
}

// ========================================
// Toast Notifications
// ========================================
function showToast(message, type = 'info') {
    elements.toastMessage.textContent = message;

    const iconMap = {
        success: 'ph-check-circle',
        error: 'ph-x-circle',
        warning: 'ph-warning',
        info: 'ph-info',
    };

    elements.toastIcon.className = `ph ${iconMap[type] || iconMap.info} text-xl`;
    elements.toast.classList.remove('translate-y-full', 'opacity-0');
    elements.toast.classList.add('translate-y-0', 'opacity-100');

    setTimeout(() => {
        elements.toast.classList.remove('translate-y-0', 'opacity-100');
        elements.toast.classList.add('translate-y-full', 'opacity-0');
    }, 3000);
}

// ========================================
// Utility Functions
// ========================================
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

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ========================================
// Initialize App
// ========================================
document.addEventListener('DOMContentLoaded', init);
