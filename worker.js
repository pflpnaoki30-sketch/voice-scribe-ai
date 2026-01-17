/**
 * VoiceScribe AI - Web Worker
 * Transformers.js (Whisper-tiny) を使用したローカル音声認識
 * 
 * ハルシネーション抑制パラメータを適用
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
            temperature: 0,                    // ランダム性を排除
            do_sample: false,                  // サンプリング無効化（greedy decoding）
            repetition_penalty: 1.2,           // 繰り返しペナルティ
            no_speech_threshold: 0.6,          // 無音/ノイズ区間の閾値

            // 追加の安定化パラメータ
            compression_ratio_threshold: 2.4,  // 圧縮率閾値（繰り返し検出）
            logprob_threshold: -1.0,           // 低確率トークン除外

            // 出力制限
            max_new_tokens: 448,               // 最大トークン数制限
        };

        const result = await transcriber(audioData, options);

        let transcribedText = result.text || '';

        // 後処理: ハルシネーションパターンの除去
        transcribedText = removeHallucinationPatterns(transcribedText);

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
 * ハルシネーションパターンを除去
 * 無音時に生成されがちな繰り返しフレーズを検出・削除
 */
function removeHallucinationPatterns(text) {
    if (!text) return '';

    // よくあるハルシネーションパターン
    const hallucinationPatterns = [
        /^[\s\S]*?(ご視聴ありがとうございました[。\.]*)+[\s\S]*$/gi,
        /^[\s\S]*?(チャンネル登録[お願いします]*[。\.]*)+[\s\S]*$/gi,
        /(それで[は]?[、。\.]*){3,}/gi,
        /(何で言って[、。\.]*){2,}/gi,
        /(ありがとうございました[。\.]*){3,}/gi,
        /(お疲れ様でした[。\.]*){3,}/gi,
        /^[\s。、\.…]+$/,  // 句読点のみ
    ];

    let cleaned = text;

    hallucinationPatterns.forEach(pattern => {
        cleaned = cleaned.replace(pattern, '');
    });

    // 同じフレーズの連続繰り返しを検出（動的検出）
    cleaned = removeDynamicRepetitions(cleaned);

    return cleaned.trim();
}

/**
 * 動的に繰り返しパターンを検出・除去
 */
function removeDynamicRepetitions(text) {
    if (!text || text.length < 10) return text;

    // 3文字以上のフレーズが3回以上連続する場合を検出
    const repetitionPattern = /(.{3,30})\1{2,}/g;
    let cleaned = text.replace(repetitionPattern, '$1');

    return cleaned;
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
