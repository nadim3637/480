export const config = {
    runtime: 'nodejs',
};

import { getAiModels, updateAiModel } from './utils/db';
import { callProvider } from './utils/providers';

export default async function handler(req: any, res: any) {
    try {
        const models = await getAiModels();
        const activeModels = models.filter(m => m.enabled);
        
        const results = [];

        for (const model of activeModels) {
            if (!model.apiKeys || model.apiKeys.length === 0) continue;
            
            // Use current key or maybe try all? Just current for now to save quota.
            const apiKey = model.apiKeys[model.currentKeyIndex || 0];
            
            try {
                // Short ping (1 token)
                await callProvider(model, [{ role: "user", content: "ping" }], apiKey);
                
                // Reset errors if successful
                if (model.status !== 'green' || (model.errorCount || 0) > 0) {
                    await updateAiModel(model.id, { status: 'green', errorCount: 0 });
                }
                results.push({ id: model.id, status: 'ok' });
            } catch (e: any) {
                console.error(`Health Check Failed: ${model.name}`, e.message);
                
                const newErrorCount = (model.errorCount || 0) + 1;
                // If 3 consecutive fails, mark red
                const newStatus = newErrorCount >= 3 ? 'red' : 'yellow';
                
                await updateAiModel(model.id, {
                    status: newStatus,
                    errorCount: newErrorCount,
                    lastError: `Health Check: ${e.message}`
                });
                
                results.push({ id: model.id, status: 'failed', error: e.message });
            }
        }

        res.status(200).json({ success: true, results });

    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
}
