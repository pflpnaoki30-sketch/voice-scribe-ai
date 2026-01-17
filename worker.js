/**
 * VoiceScribe AI - Web Worker
 * Transformers.js (Whisper-base) を使用したローカル音声認識
 * 
 * whisper-base: whisper-tinyより高精度な日本語認識
 * ハルシネーション抑制パラメータ適用
 */

import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';

env.allowLocalModels = false;
env.useBrowserCache = true;

let transcriber = null;
let isModelLoading = false;
let isModelReady = false;

// モデル設定
const MODEL_ID = 'Xenova/whisper-base';

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
            MODEL_ID,
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

        // 厳格なハルシネーション抑制設定
        const options = {
            // 言語設定（日本語固定）
            language: 'ja',
            task: 'transcribe',

            // チャンク処理
            chunk_length_s: 30,
            stride_length_s: 5,
            return_timestamps: false,

            // === 厳格設定 ===
            temperature: 0,                    // 完全に確定的な出力
            do_sample: false,                  // サンプリング無効（greedy decoding）
            repetition_penalty: 1.2,           // 繰り返しペナルティ
            no_speech_threshold: 0.6,          // 無音閾値

            // 追加の安定化
            compression_ratio_threshold: 2.4,
            logprob_threshold: -1.0,
            max_new_tokens: 448,
        };

        const result = await transcriber(audioData, options);

        let transcribedText = result.text || '';

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
