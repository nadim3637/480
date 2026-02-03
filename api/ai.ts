export const config = {
    runtime: 'nodejs',
};

import { getAiModels, updateAiModel } from './utils/db';
import { callProvider } from './utils/providers';

export default async function handler(req: any, res: any) {
    // Basic CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        res.status(405).json({ error: "Method not allowed" });
        return;
    }

    try {
        const { messages, feature = 'default', tools, tool_choice } = req.body;

        // 1. Fetch Models
        const allModels = await getAiModels();
        
        // 2. Filter & Sort
        let candidates = allModels
            .filter(m => m.enabled && m.status !== 'red')
            .sort((a, b) => a.priority - b.priority);

        if (candidates.length === 0) {
             console.error("No active AI models found.");
             res.status(503).json({ error: "No AI models available. Please contact admin." });
             return;
        }

        // 3. Routing & Failover Loop
        let lastError = null;
        let success = false;
        
        for (const model of candidates) {
            try {
                if (!model.apiKeys || model.apiKeys.length === 0) continue;
                
                const keyIndex = (model.currentKeyIndex || 0) % model.apiKeys.length;
                const apiKey = model.apiKeys[keyIndex];

                // console.log(`Attempting ${model.name} (Provider: ${model.provider})`);

                // Call Provider
                const result = await callProvider(model, messages, apiKey, tools, tool_choice);
                
                // Success! Update stats
                const nextIndex = (keyIndex + 1) % model.apiKeys.length;
                await updateAiModel(model.id, {
                    currentKeyIndex: nextIndex,
                    usedToday: (model.usedToday || 0) + 1,
                    status: 'green',
                    errorCount: 0
                });

                res.status(200).json(result);
                success = true;
                break;

            } catch (error: any) {
                console.error(`Model ${model.name} failed:`, error.message);
                lastError = error;
                
                // Update Error Stats
                await updateAiModel(model.id, {
                    errorCount: (model.errorCount || 0) + 1,
                    lastError: error.message,
                    status: (model.errorCount || 0) > 5 ? 'red' : 'yellow'
                });
                
                // Continue to next model...
            }
        }

        if (!success) {
            res.status(500).json({ 
                error: "All AI providers failed", 
                lastError: lastError?.message 
            });
        }

    } catch (e: any) {
        console.error("AI Handler Fatal Error:", e);
        res.status(500).json({ error: "Internal Server Error", detail: e.message });
    }
}
