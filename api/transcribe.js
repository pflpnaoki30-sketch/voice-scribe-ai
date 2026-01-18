/**
 * VoiceScribe AI - Transcription API
 * Vercel Serverless Function
 * 
 * Groq API (whisper-large-v3) を使用した音声文字起こし
 */

import Groq from 'groq-sdk';
import formidable from 'formidable';
import fs from 'fs';

// Body parserを無効化（multipart/form-data対応）
export const config = {
    api: {
        bodyParser: false,
    },
};

// Groqクライアント初期化
const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY,
});

/**
 * ファイルアップロードを解析
 */
function parseForm(req) {
    return new Promise((resolve, reject) => {
        const form = formidable({
            maxFileSize: 25 * 1024 * 1024, // 25MB上限
            keepExtensions: true,
        });

        form.parse(req, (err, fields, files) => {
            if (err) {
                reject(err);
            } else {
                resolve({ fields, files });
            }
        });
    });
}

/**
 * POSTハンドラ - 音声ファイルを受け取り文字起こし
 */
export default async function handler(req, res) {
    // CORS設定
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // プリフライトリクエスト対応
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // POSTのみ許可
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // フォームデータ解析
        const { files } = await parseForm(req);

        // 音声ファイル取得
        const audioFile = files.audio?.[0] || files.audio;
        if (!audioFile) {
            return res.status(400).json({ error: 'No audio file provided' });
        }

        // ファイルパス取得
        const filePath = audioFile.filepath || audioFile.path;
        if (!filePath) {
            return res.status(400).json({ error: 'Invalid file upload' });
        }

        // Groq API呼び出し
        const transcription = await groq.audio.transcriptions.create({
            file: fs.createReadStream(filePath),
            model: 'whisper-large-v3',
            language: 'ja',
            response_format: 'json',
        });

        // 一時ファイル削除
        fs.unlink(filePath, () => { });

        // 結果を返す
        return res.status(200).json({
            success: true,
            text: transcription.text || '',
        });

    } catch (error) {
        console.error('Transcription error:', error);

        // エラーレスポンス
        return res.status(500).json({
            success: false,
            error: error.message || 'Transcription failed',
        });
    }
}
