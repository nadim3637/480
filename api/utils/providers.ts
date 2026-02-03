import { AIModel } from '../../types';

export const callProvider = async (model: AIModel, messages: any[], key: string, tools?: any[], tool_choice?: any): Promise<any> => {
    try {
        switch (model.provider) {
            case 'Groq':
                return await callGroq(model, messages, key, tools, tool_choice);
            case 'Gemini':
                return await callGemini(model, messages, key, tools);
            case 'OpenAI':
            case 'DeepSeek':
            case 'Mistral':
            case 'OpenRouter':
            case 'Perplexity':
            case 'Together':
            case 'Fireworks':
            case 'Cohere':
            case 'HuggingFace':
                return await callOpenAICompatible(model, messages, key, tools, tool_choice);
            default:
                // Fallback to OpenAI format as it's the standard
                return await callOpenAICompatible(model, messages, key, tools, tool_choice);
        }
    } catch (error: any) {
        // Enhance error message with model context
        error.modelId = model.id;
        error.provider = model.provider;
        throw error;
    }
};

const callGroq = async (model: AIModel, messages: any[], key: string, tools?: any[], tool_choice?: any) => {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${key}`
        },
        body: JSON.stringify({
            model: model.modelId,
            messages,
            tools,
            tool_choice
        })
    });
    
    if (!response.ok) {
        const err = await response.text();
        throw new Error(`Groq Error ${response.status}: ${err}`);
    }
    
    return await response.json();
};

const callOpenAICompatible = async (model: AIModel, messages: any[], key: string, tools?: any[], tool_choice?: any) => {
    let url = "https://api.openai.com/v1/chat/completions";
    
    if (model.provider === 'DeepSeek') url = "https://api.deepseek.com/chat/completions";
    if (model.provider === 'Mistral') url = "https://api.mistral.ai/v1/chat/completions";
    if (model.provider === 'OpenRouter') url = "https://openrouter.ai/api/v1/chat/completions";
    if (model.provider === 'Perplexity') url = "https://api.perplexity.ai/chat/completions";
    if (model.provider === 'Together') url = "https://api.together.xyz/v1/chat/completions";
    if (model.provider === 'Fireworks') url = "https://api.fireworks.ai/inference/v1/chat/completions";
    
    // Add Authorization Header Logic
    const headers: any = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`
    };
    
    // Provider specific headers if needed
    if (model.provider === 'OpenRouter') {
        headers["HTTP-Referer"] = "https://student-app.com"; // Optional but good for OpenRouter
        headers["X-Title"] = "Student App";
    }

    const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
            model: model.modelId,
            messages,
            tools,
            tool_choice
        })
    });

    if (!response.ok) {
         const err = await response.text();
        throw new Error(`${model.provider} Error ${response.status}: ${err}`);
    }
    
    return await response.json();
};

const callGemini = async (model: AIModel, messages: any[], key: string, tools?: any[]) => {
    // Gemini REST API
    // Format: https://generativelanguage.googleapis.com/v1beta/models/{modelId}:generateContent?key={key}
    
    // Convert OpenAI messages to Gemini Content
    const contents = messages.map((m: any) => {
        let role = 'user';
        if (m.role === 'assistant') role = 'model';
        if (m.role === 'system') return null; // System instructions moved to config
        return {
            role,
            parts: [{ text: m.content }]
        };
    }).filter(Boolean);

    const systemInstruction = messages.find((m: any) => m.role === 'system');

    const payload: any = { contents };
    if (systemInstruction) {
        payload.systemInstruction = { parts: [{ text: systemInstruction.content }] };
    }
    
    // Simple Tool Mapping (if crucial, we can expand)
    // For now, if tools are present, we might warn or skip if translation is too hard.
    // Assuming text-only for now as per "Phase 1" mostly.

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model.modelId}:generateContent?key=${key}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`Gemini Error ${response.status}: ${err}`);
    }

    const data = await response.json();
    
    // Normalize to OpenAI format for frontend compatibility
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    
    return {
        choices: [
            {
                message: {
                    role: "assistant",
                    content: text
                }
            }
        ]
    };
}
