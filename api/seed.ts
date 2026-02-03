export const config = {
    runtime: 'nodejs',
};

import { saveAiModels } from './utils/db';
import { AIModel } from '../types';

export default async function handler(req: any, res: any) {
    const models: AIModel[] = [
        {
            id: 'groq-llama3',
            name: 'Groq Llama 3',
            provider: 'Groq',
            modelId: 'llama3-8b-8192',
            apiKeys: [],
            currentKeyIndex: 0,
            enabled: true,
            priority: 1,
            dailyLimit: 5000,
            usedToday: 0,
            status: 'green'
        },
        {
            id: 'gemini-pro',
            name: 'Gemini Pro',
            provider: 'Gemini',
            modelId: 'gemini-1.5-flash',
            apiKeys: [],
            currentKeyIndex: 0,
            enabled: true,
            priority: 2,
            dailyLimit: 1000,
            usedToday: 0,
            status: 'green'
        },
        {
            id: 'claude-sonnet',
            name: 'Claude Sonnet',
            provider: 'Claude',
            modelId: 'claude-3-sonnet-20240229',
            apiKeys: [],
            currentKeyIndex: 0,
            enabled: false,
            priority: 3,
            dailyLimit: 500,
            usedToday: 0,
            status: 'green'
        },
        {
            id: 'openai-gpt4o',
            name: 'OpenAI GPT-4o',
            provider: 'OpenAI',
            modelId: 'gpt-4o',
            apiKeys: [],
            currentKeyIndex: 0,
            enabled: false,
            priority: 4,
            dailyLimit: 500,
            usedToday: 0,
            status: 'green'
        },
        {
            id: 'deepseek-chat',
            name: 'DeepSeek Chat',
            provider: 'DeepSeek',
            modelId: 'deepseek-chat',
            apiKeys: [],
            currentKeyIndex: 0,
            enabled: true,
            priority: 2,
            dailyLimit: 2000,
            usedToday: 0,
            status: 'green'
        },
        {
            id: 'mistral-large',
            name: 'Mistral Large',
            provider: 'Mistral',
            modelId: 'mistral-large-latest',
            apiKeys: [],
            currentKeyIndex: 0,
            enabled: false,
            priority: 3,
            dailyLimit: 1000,
            usedToday: 0,
            status: 'green'
        }
    ];

    try {
        await saveAiModels(models);
        res.status(200).json({ success: true, count: models.length });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
}
