import * as admin from 'firebase-admin';
import { AIModel } from '../../types';

// Prevent multiple initializations
if (!admin.apps.length) {
    try {
        // Initializes with default credentials (GOOGLE_APPLICATION_CREDENTIALS)
        // and reads FIREBASE_DATABASE_URL from env if available.
        // If not, we might default to the one I saw in code or just rely on env.
        // In this environment, I'll rely on Env or default.
        admin.initializeApp({
            credential: admin.credential.applicationDefault(),
            databaseURL: process.env.FIREBASE_DATABASE_URL 
        });
    } catch (e) {
        console.error("Firebase Admin Init Error:", e);
    }
}

let rtdb: admin.database.Database;
try {
    rtdb = admin.database();
} catch(e) {
    console.error("RTDB Init Error:", e);
}

export const getAiModels = async (): Promise<AIModel[]> => {
    if (!rtdb) return [];
    try {
        const snapshot = await rtdb.ref('ai_models').once('value');
        if (!snapshot.exists()) return [];
        const data = snapshot.val();
        if (Array.isArray(data)) return data;
        return Object.values(data);
    } catch (e) {
        console.error("Error fetching AI models:", e);
        return [];
    }
};

export const updateAiModel = async (id: string, updates: Partial<AIModel>) => {
    if (!rtdb) return;
    try {
        await rtdb.ref(`ai_models/${id}`).update(updates);
    } catch (e) {
        console.error(`Error updating AI model ${id}:`, e);
    }
};

export const saveAiModels = async (models: AIModel[]) => {
    if (!rtdb) return;
    const modelsObj: Record<string, AIModel> = {};
    models.forEach(m => modelsObj[m.id] = m);
    await rtdb.ref('ai_models').set(modelsObj);
};
