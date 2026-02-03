import React, { useEffect, useState } from 'react';
import { rtdb } from '../firebase';
import { ref, onValue, update, remove } from "firebase/database";
import { AIModel, AIProvider } from '../types';
import { Save, Plus, Trash2, Edit3, X, Key, Activity } from 'lucide-react';

export const AiModelManager: React.FC = () => {
    const [models, setModels] = useState<AIModel[]>([]);
    const [isEditing, setIsEditing] = useState(false);
    const [editModel, setEditModel] = useState<Partial<AIModel>>({});
    const [newKey, setNewKey] = useState('');

    useEffect(() => {
        const modelsRef = ref(rtdb, 'ai_models');
        const unsub = onValue(modelsRef, (snapshot) => {
            const data = snapshot.val();
            if (data) {
                const list = Array.isArray(data) ? data : Object.values(data);
                setModels(list as AIModel[]);
            } else {
                setModels([]);
            }
        });
        return () => unsub();
    }, []);

    const handleSave = async () => {
        if (!editModel.name || !editModel.provider) return;
        
        const id = editModel.id || `model-${Date.now()}`;
        const finalModel: AIModel = {
            id,
            name: editModel.name,
            provider: editModel.provider as AIProvider,
            modelId: editModel.modelId || 'llama3-8b-8192',
            apiKeys: editModel.apiKeys || [],
            currentKeyIndex: editModel.currentKeyIndex || 0,
            enabled: editModel.enabled ?? true,
            priority: editModel.priority || 1,
            dailyLimit: editModel.dailyLimit || 1000,
            usedToday: editModel.usedToday || 0,
            status: editModel.status || 'green'
        };

        await update(ref(rtdb, `ai_models/${id}`), finalModel);
        setIsEditing(false);
        setEditModel({});
    };

    const handleDelete = async (id: string) => {
        if (confirm("Are you sure?")) {
            await remove(ref(rtdb, `ai_models/${id}`));
        }
    };

    const handleAddKey = () => {
        if (!newKey) return;
        const keys = [...(editModel.apiKeys || []), newKey];
        setEditModel({ ...editModel, apiKeys: keys });
        setNewKey('');
    };

    const removeKey = (idx: number) => {
        const keys = (editModel.apiKeys || []).filter((_, i) => i !== idx);
        setEditModel({ ...editModel, apiKeys: keys });
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-2xl font-black text-slate-800 flex items-center gap-2">
                        <Activity className="text-blue-600" /> AI ORCHESTRATOR
                    </h2>
                    <p className="text-slate-500 text-sm">Manage AI Providers, Failover Priorities & Key Rotation</p>
                </div>
                <button 
                    onClick={() => { setEditModel({ enabled: true, priority: 5, apiKeys: [] }); setIsEditing(true); }}
                    className="bg-blue-600 text-white px-4 py-2 rounded-xl font-bold flex items-center gap-2 hover:bg-blue-700"
                >
                    <Plus size={18} /> Add Model
                </button>
            </div>

            <div className="grid gap-4">
                {models.sort((a, b) => a.priority - b.priority).map((m) => (
                    <div key={m.id} className={`p-4 rounded-2xl border-2 transition-all ${m.enabled ? 'bg-white border-slate-200' : 'bg-slate-50 border-slate-100 opacity-75'}`}>
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-4">
                                <div className={`w-12 h-12 rounded-xl flex items-center justify-center font-black text-lg ${m.status === 'green' ? 'bg-green-100 text-green-600' : m.status === 'yellow' ? 'bg-yellow-100 text-yellow-600' : 'bg-red-100 text-red-600'}`}>
                                    {m.priority}
                                </div>
                                <div>
                                    <h3 className="font-bold text-lg text-slate-800">{m.name}</h3>
                                    <div className="flex items-center gap-2 text-xs font-mono text-slate-500">
                                        <span className="bg-slate-100 px-2 py-0.5 rounded border border-slate-200">{m.provider}</span>
                                        <span>•</span>
                                        <span>{m.modelId}</span>
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="text-right mr-4">
                                    <p className="text-xs font-bold text-slate-400 uppercase">Usage</p>
                                    <p className="font-black text-slate-800">{m.usedToday} <span className="text-slate-400 text-xs">/ {m.dailyLimit}</span></p>
                                </div>
                                <button onClick={() => { setEditModel(m); setIsEditing(true); }} className="p-2 hover:bg-slate-100 rounded-lg text-blue-600"><Edit3 size={18} /></button>
                                <button onClick={() => handleDelete(m.id)} className="p-2 hover:bg-red-50 rounded-lg text-red-500"><Trash2 size={18} /></button>
                            </div>
                        </div>

                        <div className="flex items-center gap-2 bg-slate-50 p-2 rounded-lg border border-slate-100">
                            <Key size={14} className="text-slate-400 ml-2" />
                            <div className="flex-1 flex gap-1 overflow-hidden">
                                {m.apiKeys?.map((k, i) => (
                                    <div key={i} className={`w-8 h-1.5 rounded-full ${i === m.currentKeyIndex ? 'bg-blue-500' : 'bg-slate-300'}`} title={`Key ${i+1}`} />
                                ))}
                            </div>
                            <span className="text-xs font-bold text-slate-500">{m.apiKeys?.length || 0} Keys</span>
                        </div>
                    </div>
                ))}
            </div>

            {isEditing && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
                    <div className="bg-white p-6 rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-xl font-bold">Configure AI Model</h3>
                            <button onClick={() => setIsEditing(false)}><X size={24} className="text-slate-400" /></button>
                        </div>

                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs font-bold text-slate-500 uppercase">Display Name</label>
                                    <input type="text" value={editModel.name || ''} onChange={e => setEditModel({...editModel, name: e.target.value})} className="w-full p-2 border rounded-lg" placeholder="My Groq" />
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-slate-500 uppercase">Provider</label>
                                    <select value={editModel.provider || ''} onChange={e => setEditModel({...editModel, provider: e.target.value as any})} className="w-full p-2 border rounded-lg bg-white">
                                        <option value="">Select...</option>
                                        <option value="Groq">Groq</option>
                                        <option value="Gemini">Gemini</option>
                                        <option value="OpenAI">OpenAI</option>
                                        <option value="DeepSeek">DeepSeek</option>
                                        <option value="Mistral">Mistral</option>
                                        <option value="Ollama">Ollama (Local)</option>
                                    </select>
                                </div>
                            </div>

                            <div>
                                <label className="text-xs font-bold text-slate-500 uppercase">Model ID (API String)</label>
                                <input type="text" value={editModel.modelId || ''} onChange={e => setEditModel({...editModel, modelId: e.target.value})} className="w-full p-2 border rounded-lg font-mono text-sm" placeholder="e.g. llama3-8b-8192" />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs font-bold text-slate-500 uppercase">Priority (1 = High)</label>
                                    <input type="number" value={editModel.priority || 1} onChange={e => setEditModel({...editModel, priority: Number(e.target.value)})} className="w-full p-2 border rounded-lg" />
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-slate-500 uppercase">Daily Limit</label>
                                    <input type="number" value={editModel.dailyLimit || 1000} onChange={e => setEditModel({...editModel, dailyLimit: Number(e.target.value)})} className="w-full p-2 border rounded-lg" />
                                </div>
                            </div>

                            <div className="border-t pt-4">
                                <label className="text-xs font-bold text-slate-500 uppercase block mb-2">API Keys Rotation</label>
                                <div className="flex gap-2 mb-2">
                                    <input type="text" value={newKey} onChange={e => setNewKey(e.target.value)} className="flex-1 p-2 border rounded-lg text-sm font-mono" placeholder="Paste API Key here..." />
                                    <button onClick={handleAddKey} className="bg-slate-800 text-white px-4 rounded-lg font-bold">Add</button>
                                </div>
                                <div className="space-y-2 max-h-40 overflow-y-auto bg-slate-50 p-2 rounded-lg border border-slate-100">
                                    {editModel.apiKeys?.map((k, i) => (
                                        <div key={i} className="flex items-center justify-between text-xs bg-white p-2 rounded border border-slate-200">
                                            <span className="font-mono truncate w-4/5">{k.substring(0, 8)}...{k.substring(k.length-6)}</span>
                                            <button onClick={() => removeKey(i)} className="text-red-500 hover:text-red-700"><X size={14} /></button>
                                        </div>
                                    ))}
                                    {(!editModel.apiKeys || editModel.apiKeys.length === 0) && <p className="text-center text-slate-400 text-xs py-2">No keys added.</p>}
                                </div>
                            </div>

                            <div className="flex items-center justify-between pt-4 border-t">
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input type="checkbox" checked={editModel.enabled ?? true} onChange={e => setEditModel({...editModel, enabled: e.target.checked})} className="w-5 h-5 accent-blue-600" />
                                    <span className="font-bold text-slate-700">Enable Model</span>
                                </label>
                                <button onClick={handleSave} className="bg-green-600 text-white px-6 py-2 rounded-xl font-bold shadow-lg hover:bg-green-700 flex items-center gap-2">
                                    <Save size={18} /> Save Model
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
