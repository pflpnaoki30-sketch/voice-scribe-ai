/**
 * VoiceScribe AI - Web Worker
 * Transformers.js (Whisper-tiny) を使用したローカル音声認識
 * 
 * ハルシネーション抑制パラメータ適用版
 */

import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';

env.allowLocalModels = false;
env.useBrowserCache = true;

let transcriber = null;
let isModelLoading = false;
let isModelReady = false;

async function initializeModel() {
    if (isModelLoading || isModelReady) return;

    isModelLoading = true;

    try {
        self.postMessage({
            type: 'status',
            status: 'loading',
            message: 'AIモデルを準備中...'
        });

        transcriber = await pipeline(
            'automatic-speech-recognition',
            'Xenova/whisper-tiny',
            {
                quantized: true,
                progress_callback: (progress) => {
                    if (progress.status === 'progress') {
                        const percent = Math.round((progress.loaded / progress.total) * 100);
                        self.postMessage({
                            type: 'progress',
                            percent: percent,
                            message: `モデル読込中: ${percent}%`,
                            file: progress.file
                        });
                    } else if (progress.status === 'done') {
                        self.postMessage({
                            type: 'progress',
                            percent: 100,
                            message: 'モデル準備完了',
                            file: progress.file
                        });
                    }
                }
            }
        );

        isModelReady = true;
        isModelLoading = false;

        self.postMessage({
            type: 'status',
            status: 'ready',
            message: '準備完了'
        });

    } catch (error) {
        isModelLoading = false;
        console.error('Model initialization failed:', error);

        self.postMessage({
            type: 'error',
            message: `モデルの読み込みに失敗しました: ${error.message}`
        });
    }
}

async function transcribe(audioData, keywordPrompt = '') {
    if (!isModelReady) {
        await initializeModel();
        if (!isModelReady) {
            self.postMessage({
                type: 'error',
                message: 'モデルが利用できません'
            });
            return;
        }
    }

    try {
        self.postMessage({
            type: 'status',
            status: 'transcribing',
            message: '認識中...'
        });

        // ハルシネーション抑制のための最適化パラメータ
        const options = {
            // 言語設定
            language: 'ja',
            task: 'transcribe',

            // チャンク処理設定
            chunk_length_s: 30,
            stride_length_s: 5,
            return_timestamps: false,

            // ハルシネーション抑制パラメータ
            // temperature 0.2: 少しのランダム性でループ回避
            temperature: 0.2,
            do_sample: false,

            // 繰り返し抑制
            repetition_penalty: 1.5,           // より強いペナルティ
            no_repeat_ngram_size: 3,           // 3-gramの繰り返しを禁止

            // 無音/ノイズ閾値
            no_speech_threshold: 0.6,
            compression_ratio_threshold: 2.4,
            logprob_threshold: -1.0,

            // 出力制限
            max_new_tokens: 256,               // 短めに制限
        };

        const result = await transcriber(audioData, options);

        let transcribedText = result.text || '';

        // Worker側でも基本的なサニタイズを実行
        transcribedText = sanitizeWorkerOutput(transcribedText);

        // キーワード補正
        if (keywordPrompt && keywordPrompt.trim()) {
            transcribedText = applyKeywordCorrections(transcribedText, keywordPrompt);
        }

        self.postMessage({
            type: 'result',
            text: transcribedText.trim(),
            raw: result.text
        });

        self.postMessage({
            type: 'status',
            status: 'ready',
            message: '準備完了'
        });

    } catch (error) {
        console.error('Transcription failed:', error);

        self.postMessage({
            type: 'error',
            message: `認識エラー: ${error.message}`
        });

        self.postMessage({
            type: 'status',
            status: 'ready',
            message: '準備完了'
        });
    }
}

/**
 * Worker側での基本サニタイズ
 */
function sanitizeWorkerOutput(text) {
    if (!text) return '';

    let cleaned = text;

    // 数字・記号の連続パターンを削除
    cleaned = cleaned.replace(/[\d\.]{5,}/g, '');           // 8.8.8.8... 等
    cleaned = cleaned.replace(/\.{3,}/g, '');               // ......
    cleaned = cleaned.replace(/。{2,}/g, '。');             // 。。。→。
    cleaned = cleaned.replace(/、{2,}/g, '、');             // 、、、→、

    // 明らかなハルシネーションパターン
    const hallucinationPatterns = [
        /^(ご視聴)?ありがとうございました[。\.]*$/i,
        /^チャンネル登録.*$/i,
        /^高評価.*$/i,
        /^\(.*\)$/,                                          // (笑)のみ等
    ];

    for (const pattern of hallucinationPatterns) {
        if (pattern.test(cleaned.trim())) {
            return '';
        }
    }

    return cleaned.trim();
}

/**
 * キーワード補正を適用
 */
function applyKeywordCorrections(text, keywordPrompt) {
    const keywords = keywordPrompt.split(',').map(k => k.trim()).filter(k => k);
    let correctedText = text;

    keywords.forEach(keyword => {
        const regex = new RegExp(escapeRegExp(keyword), 'gi');
        correctedText = correctedText.replace(regex, keyword);
    });

    return correctedText;
}

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

self.onmessage = async (event) => {
    const { type, audioData, keywords } = event.data;

    switch (type) {
        case 'init':
            await initializeModel();
            break;

        case 'transcribe':
            if (audioData && audioData.length > 0) {
                await transcribe(audioData, keywords || '');
            } else {
                self.postMessage({
                    type: 'error',
                    message: '音声データが空です'
                });
            }
            break;

        case 'check':
            self.postMessage({
                type: 'status',
                status: isModelReady ? 'ready' : (isModelLoading ? 'loading' : 'idle'),
                message: isModelReady ? '準備完了' : (isModelLoading ? '読込中...' : '待機中')
            });
            break;
    }
};

self.postMessage({
    type: 'status',
    status: 'idle',
    message: 'Worker準備完了'
});
