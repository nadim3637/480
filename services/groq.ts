
import { ClassLevel, Subject, Chapter, LessonContent, Language, Board, Stream, ContentType, MCQItem, SystemSettings } from "../types";
import { STATIC_SYLLABUS } from "../constants";
import { getChapterData, getCustomSyllabus, incrementApiUsage, getApiUsage, rtdb } from "../firebase";
import { ref, get } from "firebase/database";
import { storage } from "../utils/storage";

// UNIFIED AI GATEWAY
const CALL_AI_ENDPOINT = "/api/ai";

export const callGroqApi = async (messages: any[], model: string = "llama3-8b-8192") => {
    const response = await fetch(CALL_AI_ENDPOINT, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            messages: messages,
            feature: 'fast_inference',
            modelHint: model
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`AI Engine Error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
};

export const callGroqApiWithTools = async (messages: any[], tools: any[], model: string = "llama-3.3-70b-versatile") => {
    const response = await fetch(CALL_AI_ENDPOINT, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            messages,
            tools,
            tool_choice: "auto",
            feature: 'complex_reasoning'
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`AI Engine Error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return data.choices[0].message; 
};

// STREAMING WRAPPER (Buffered for Reliability)
export const callGroqApiStream = async (messages: any[], onChunk: (text: string) => void, model: string = "llama3-8b-8192") => {
    // We use the non-streaming endpoint to ensure the backend failover logic works (Wait for full response)
    const content = await callGroqApi(messages, model);
    onChunk(content);
    return content;
};

export const executeWithRotation = async <T>(
    operation: () => Promise<T>,
    usageType: 'PILOT' | 'STUDENT' = 'STUDENT'
): Promise<T> => {
    
    // CLIENT SIDE QUOTA CHECK (UI Feedback)
    try {
        const usage = await getApiUsage();
        if (usage) {
            const settingsStr = localStorage.getItem('nst_system_settings');
            const settings = settingsStr ? JSON.parse(settingsStr) : {};
            const pilotRatio = settings.aiPilotRatio || 80;
            const dailyLimit = settings.aiDailyLimitPerKey || 1500; // Legacy setting
            
            // Allow loose limit on client, backend enforces strict limit
            const totalCapacity = 50000; 

            const pilotLimit = Math.floor(totalCapacity * (pilotRatio / 100));
            const studentLimit = totalCapacity - pilotLimit;

            if (usageType === 'PILOT') {
                if ((usage.pilotCount || 0) >= pilotLimit) throw new Error(`AI Pilot Quota Exceeded (${usage.pilotCount}/${pilotLimit})`);
            } else {
                 if ((usage.studentCount || 0) >= studentLimit) throw new Error(`Student AI Quota Exceeded. Try again later.`);
            }
        }
    } catch(e: any) {
        if (e.message && e.message.includes("Quota Exceeded")) throw e;
    }

    // RETRY LOGIC (Network Errors)
    const MAX_RETRIES = 1;
    for (let i = 0; i <= MAX_RETRIES; i++) {
        try {
            const result = await operation();
            return result;
        } catch (error: any) {
            const msg = error?.message || "";
            console.warn(`Attempt ${i + 1} failed: ${msg}`);
            
            if (i === MAX_RETRIES) throw error;
            await new Promise(res => setTimeout(res, 1000 * (i + 1)));
        }
    }
    
    throw new Error("Unexpected error in AI service.");
};

// --- PARALLEL BULK EXECUTION ENGINE ---
const executeBulkParallel = async <T>(
    tasks: (() => Promise<T>)[],
    concurrency: number = 20, 
    usageType: 'PILOT' | 'STUDENT' = 'STUDENT'
): Promise<T[]> => {

    console.log(`🚀 Starting Bulk Engine (AI Gateway): ${tasks.length} tasks (Parallelism: ${concurrency})`);

    const results: T[] = new Array(tasks.length);
    let taskIndex = 0;
    
    const worker = async (workerId: number) => {
        while (taskIndex < tasks.length) {
            const currentTaskIndex = taskIndex++; 
            if (currentTaskIndex >= tasks.length) break;

            const task = tasks[currentTaskIndex];
            
            try {
                const result = await task();
                results[currentTaskIndex] = result;
                // Backend tracks usage now
            } catch (error) {
                console.error(`Task ${currentTaskIndex} failed:`, error);
            }
        }
    };

    const activeWorkers = Math.min(concurrency, tasks.length); 
    const workers = Array.from({ length: activeWorkers }, (_, i) => worker(i));
    
    await Promise.all(workers);
    return results.filter(r => r !== undefined && r !== null);
};

const chapterCache: Record<string, Chapter[]> = {};
const cleanJson = (text: string) => {
    return text.replace(/```json/g, '').replace(/```/g, '').trim();
};

export const translateToHindi = async (content: string, isJson: boolean = false, usageType: 'PILOT' | 'STUDENT' = 'STUDENT'): Promise<string> => {
    const prompt = `
    You are an expert translator for Bihar Board students.
    Translate the following ${isJson ? 'JSON Data' : 'Educational Content'} into Hindi (Devanagari).
    
    Style Guide:
    - Use "Hinglish" for technical terms (e.g., "Force" -> "Force (बल)").
    - Keep tone simple and student-friendly.
    - ${isJson ? 'Maintain strict JSON structure. Only translate values (question, options, explanation, etc). Do NOT translate keys.' : 'Keep Markdown formatting intact.'}

    CONTENT:
    ${content}
    `;

    return await executeWithRotation(async () => {
        return await callGroqApi([{ role: "user", content: prompt }]);
    }, usageType);
};

// ... (getAdminContent and fetchChapters remain largely same, just imported types) ...
// Copied explicitly to ensure consistency

const getAdminContent = async (
    board: Board, 
    classLevel: ClassLevel, 
    stream: Stream | null, 
    subject: Subject, 
    chapterId: string,
    type: ContentType,
    syllabusMode: 'SCHOOL' | 'COMPETITION' = 'SCHOOL'
): Promise<LessonContent | null> => {
    const streamKey = (classLevel === '11' || classLevel === '12') && stream ? `-${stream}` : '';
    const key = `nst_content_${board}_${classLevel}${streamKey}_${subject.name}_${chapterId}`;
    
    try {
        let parsed = await getChapterData(key);
        if (!parsed) parsed = await storage.getItem(key);

        if (parsed) {
            if (type === 'PDF_FREE' || type === 'NOTES_SIMPLE') {
                const linkKey = syllabusMode === 'SCHOOL' ? 'schoolPdfLink' : 'competitionPdfLink';
                const htmlKey = syllabusMode === 'SCHOOL' ? 'schoolFreeNotesHtml' : 'competitionFreeNotesHtml';
                
                const link = parsed[linkKey] || parsed.freeLink;
                const html = parsed[htmlKey] || parsed.freeNotesHtml;

                if (link && type === 'PDF_FREE') {
                    return {
                        id: Date.now().toString(),
                        title: "Free Study Material",
                        subtitle: "Provided by Admin",
                        content: link,
                        type: 'PDF_FREE',
                        dateCreated: new Date().toISOString(),
                        subjectName: subject.name,
                        isComingSoon: false
                    };
                }
                
                if (html && (type === 'NOTES_SIMPLE' || type === 'PDF_FREE')) {
                     return {
                        id: Date.now().toString(),
                        title: "Study Notes",
                        subtitle: "Detailed Notes (Admin)",
                        content: html,
                        type: 'NOTES_SIMPLE',
                        dateCreated: new Date().toISOString(),
                        subjectName: subject.name,
                        isComingSoon: false
                    };
                }
            }

            if (type === 'PDF_PREMIUM' || type === 'NOTES_PREMIUM') {
                const linkKey = syllabusMode === 'SCHOOL' ? 'schoolPdfPremiumLink' : 'competitionPdfPremiumLink';
                const htmlKey = syllabusMode === 'SCHOOL' ? 'schoolPremiumNotesHtml' : 'competitionPremiumNotesHtml';
                
                const link = parsed[linkKey] || parsed.premiumLink;
                const html = parsed[htmlKey] || parsed.premiumNotesHtml;

                if (link && type === 'PDF_PREMIUM') {
                    return {
                        id: Date.now().toString(),
                        title: "Premium Notes",
                        subtitle: "High Quality Content",
                        content: link,
                        type: 'PDF_PREMIUM',
                        dateCreated: new Date().toISOString(),
                        subjectName: subject.name,
                        isComingSoon: false
                    };
                }

                if (html && (type === 'NOTES_PREMIUM' || type === 'PDF_PREMIUM')) {
                    const htmlKeyHI = syllabusMode === 'SCHOOL' ? 'schoolPremiumNotesHtml_HI' : 'competitionPremiumNotesHtml_HI';
                    const htmlHI = parsed[htmlKeyHI];

                    return {
                        id: Date.now().toString(),
                        title: "Premium Notes",
                        subtitle: "Exclusive Content (Admin)",
                        content: html,
                        type: 'NOTES_PREMIUM',
                        dateCreated: new Date().toISOString(),
                        subjectName: subject.name,
                        isComingSoon: false,
                        schoolPremiumNotesHtml_HI: syllabusMode === 'SCHOOL' ? htmlHI : undefined,
                        competitionPremiumNotesHtml_HI: syllabusMode === 'COMPETITION' ? htmlHI : undefined
                    };
                }
            }

            if (type === 'VIDEO_LECTURE' && (parsed.premiumVideoLink || parsed.freeVideoLink)) {
                return {
                    id: Date.now().toString(),
                    title: "Video Lecture",
                    subtitle: "Watch Class",
                    content: parsed.premiumVideoLink || parsed.freeVideoLink,
                    type: 'PDF_VIEWER',
                    dateCreated: new Date().toISOString(),
                    subjectName: subject.name,
                    isComingSoon: false
                };
            }

            if (type === 'PDF_VIEWER' && parsed.link) {
                return {
                    id: Date.now().toString(),
                    title: "Class Notes", 
                    subtitle: "Provided by Teacher",
                    content: parsed.link, 
                    type: 'PDF_VIEWER',
                    dateCreated: new Date().toISOString(),
                    subjectName: subject.name,
                    isComingSoon: false
                };
            }
            
            if ((type === 'MCQ_SIMPLE' || type === 'MCQ_ANALYSIS') && parsed.manualMcqData) {
                return {
                    id: Date.now().toString(),
                    title: "Class Test (Admin)",
                    subtitle: `${parsed.manualMcqData.length} Questions`,
                    content: '',
                    type: type,
                    dateCreated: new Date().toISOString(),
                    subjectName: subject.name,
                    mcqData: parsed.manualMcqData,
                    manualMcqData_HI: parsed.manualMcqData_HI
                }
            }
        }
    } catch (e) {
        console.error("Content Lookup Error", e);
    }
    return null;
};

export const fetchChapters = async (
  board: Board,
  classLevel: ClassLevel, 
  stream: Stream | null,
  subject: Subject,
  language: Language
): Promise<Chapter[]> => {
  const streamKey = (classLevel === '11' || classLevel === '12') && stream ? `-${stream}` : '';
  const cacheKey = `${board}-${classLevel}${streamKey}-${subject.name}-${language}`;
  
  const firebaseChapters = await getCustomSyllabus(cacheKey);
  if (firebaseChapters && firebaseChapters.length > 0) {
      return firebaseChapters;
  }

  const customChapters = await storage.getItem<Chapter[]>(`nst_custom_chapters_${cacheKey}`);
  if (customChapters && customChapters.length > 0) return customChapters;

  if (chapterCache[cacheKey]) return chapterCache[cacheKey];

  const staticKey = `${board}-${classLevel}-${subject.name}`; 
  const staticList = STATIC_SYLLABUS[staticKey];
  if (staticList && staticList.length > 0) {
      const chapters: Chapter[] = staticList.map((title, idx) => ({
          id: `static-${idx + 1}`,
          title: title,
          description: `Chapter ${idx + 1}`
      }));
      chapterCache[cacheKey] = chapters;
      return chapters;
  }

  const prompt = `List 15 standard chapters for ${classLevel === 'COMPETITION' ? 'Competitive Exam' : `Class ${classLevel}`} ${stream ? stream : ''} Subject: ${subject.name} (${board}). Return JSON array: [{"title": "...", "description": "..."}].`;
  try {
    const data = await executeWithRotation(async () => {
        const content = await callGroqApi([
             { role: "system", content: "You are a helpful educational assistant. You MUST return strictly valid JSON array. Do not wrap in markdown block." },
             { role: "user", content: prompt }
        ]);
        return JSON.parse(cleanJson(content || '[]'));
    }, 'STUDENT');
    const chapters: Chapter[] = data.map((item: any, index: number) => ({
      id: `ch-${index + 1}`,
      title: item.title,
      description: item.description || ''
    }));
    chapterCache[cacheKey] = chapters;
    return chapters;
  } catch (error) {
    console.error("Chapter Fetch Error:", error);
    const data = [{id:'1', title: 'Chapter 1'}, {id:'2', title: 'Chapter 2'}];
    chapterCache[cacheKey] = data;
    return data;
  }
};

export const fetchLessonContent = async (
  board: Board,
  classLevel: ClassLevel,
  stream: Stream | null,
  subject: Subject,
  chapter: Chapter,
  language: Language,
  type: ContentType,
  existingMCQCount: number = 0,
  isPremium: boolean = false,
  targetQuestions: number = 15,
  adminPromptOverride: string = "",
  allowAiGeneration: boolean = false,
  syllabusMode: 'SCHOOL' | 'COMPETITION' = 'SCHOOL',
  forceRegenerate: boolean = false,
  dualGeneration: boolean = false,
  usageType: 'PILOT' | 'STUDENT' = 'STUDENT',
  onStream?: (text: string) => void
): Promise<LessonContent> => {
  
  let customInstruction = "";
  let promptNotes = "";
  let promptNotesPremium = "";
  let promptMCQ = "";

  try {
      const stored = localStorage.getItem('nst_system_settings');
      if (stored) {
          const s = JSON.parse(stored) as SystemSettings;
          if (s.aiInstruction) customInstruction = `IMPORTANT INSTRUCTION: ${s.aiInstruction}`;
          
           if (syllabusMode === 'COMPETITION') {
              if (board === 'CBSE') {
                  if (s.aiPromptNotesCompetitionCBSE) promptNotes = s.aiPromptNotesCompetitionCBSE;
                  if (s.aiPromptNotesPremiumCompetitionCBSE) promptNotesPremium = s.aiPromptNotesPremiumCompetitionCBSE;
                  if (s.aiPromptMCQCompetitionCBSE) promptMCQ = s.aiPromptMCQCompetitionCBSE;
              }
              if (!promptNotes && s.aiPromptNotesCompetition) promptNotes = s.aiPromptNotesCompetition;
              if (!promptNotesPremium && s.aiPromptNotesPremiumCompetition) promptNotesPremium = s.aiPromptNotesPremiumCompetition;
              if (!promptMCQ && s.aiPromptMCQCompetition) promptMCQ = s.aiPromptMCQCompetition;

          } else {
              if (board === 'CBSE') {
                  if (s.aiPromptNotesCBSE) promptNotes = s.aiPromptNotesCBSE;
                  if (s.aiPromptNotesPremiumCBSE) promptNotesPremium = s.aiPromptNotesPremiumCBSE;
                  if (s.aiPromptMCQCBSE) promptMCQ = s.aiPromptMCQCBSE;
              }
              if (!promptNotes && s.aiPromptNotes) promptNotes = s.aiPromptNotes;
              if (!promptNotesPremium && s.aiPromptNotesPremium) promptNotesPremium = s.aiPromptNotesPremium;
              if (!promptMCQ && s.aiPromptMCQ) promptMCQ = s.aiPromptMCQ;
          }
      }
  } catch(e) {}

  if (!forceRegenerate) {
      const adminContent = await getAdminContent(board, classLevel, stream, subject, chapter.id, type, syllabusMode);
      if (adminContent) {
          return { ...adminContent, title: chapter.title };
      }
  }

  if (type === 'PDF_FREE' || type === 'PDF_PREMIUM' || type === 'PDF_VIEWER') {
      return {
          id: Date.now().toString(),
          title: chapter.title,
          subtitle: "Content Unavailable",
          content: "",
          type: type,
          dateCreated: new Date().toISOString(),
          subjectName: subject.name,
          isComingSoon: true 
      };
  }

  if (!allowAiGeneration) {
      return {
          id: Date.now().toString(),
          title: chapter.title,
          subtitle: "Content Unavailable",
          content: "",
          type: type,
          dateCreated: new Date().toISOString(),
          subjectName: subject.name,
          isComingSoon: true
      };
  }
  
  // MCQ Mode
  if (type === 'MCQ_ANALYSIS' || type === 'MCQ_SIMPLE') {
      const effectiveCount = Math.max(targetQuestions, 20); 

      let prompt = "";
      if (promptMCQ) {
           prompt = processTemplate(promptMCQ, {
               board: board || '',
               class: classLevel,
               stream: stream || '',
               subject: subject.name,
               chapter: chapter.title,
               language: language,
               count: effectiveCount.toString(),
               instruction: customInstruction
           });
           if (adminPromptOverride) prompt += `\nINSTRUCTION: ${adminPromptOverride}`;
      } else {
          const competitionConstraints = syllabusMode === 'COMPETITION' 
              ? "STYLE: Fact-Heavy, Direct. HIGHLIGHT PYQs (Previous Year Questions) if relevant." 
              : "STYLE: Strict NCERT Pattern.";

          prompt = `${customInstruction}
          ${adminPromptOverride ? `INSTRUCTION: ${adminPromptOverride}` : ''}
          Create ${effectiveCount} MCQs for ${board} Class ${classLevel} ${subject.name}, Chapter: "${chapter.title}". 
          Language: ${language}.
          ${competitionConstraints}
          
          STRICT FORMAT RULE:
          Return ONLY a valid JSON array. No markdown blocks, no extra text.
          [
            {
              "question": "Question text",
              "options": ["A", "B", "C", "D"],
              "correctAnswer": 0, // Index 0-3
              "explanation": "Logical explanation here",
              "mnemonic": "Short memory trick",
              "concept": "Core concept"
            }
          ]
          
          CRITICAL: You MUST return EXACTLY ${effectiveCount} questions. 
          Provide a very diverse set of questions covering every small detail of the chapter.`;
      }

      let data: any[] = [];
      const mcqSystemPrompt = "You are an exam generator. You MUST return strict valid JSON array only. No introduction, no markdown formatting (like ```json), no ending notes. Just the raw JSON array.";

      if (effectiveCount > 30) {
          const batchSize = 20; 
          const batches = Math.ceil(effectiveCount / batchSize);
          const tasks: (() => Promise<any[]>)[] = [];

          for (let i = 0; i < batches; i++) {
              tasks.push(async () => {
                  const batchPrompt = processTemplate(prompt, {
                      board: board || '',
                      class: classLevel,
                      stream: stream || '',
                      subject: subject.name,
                      chapter: chapter.title,
                      language: language,
                      count: batchSize.toString(),
                      instruction: `${customInstruction}\nBATCH ${i+1}/${batches}. Ensure diversity. Avoid duplicates from previous batches if possible.`
                  });

                  const content = await callGroqApi([
                      { role: "system", content: mcqSystemPrompt },
                      { role: "user", content: batchPrompt }
                  ]);
                  return JSON.parse(cleanJson(content || '[]'));
              });
          }

          const allResults = await executeBulkParallel(tasks, 50, usageType);
          data = allResults.flat();
          
          const seen = new Set();
          data = data.filter(q => {
              const duplicate = seen.has(q.question);
              seen.add(q.question);
              return !duplicate;
          });
          
          if (data.length > effectiveCount) data = data.slice(0, effectiveCount);

      } else {
          data = await executeWithRotation(async () => {
              const content = await callGroqApi([
                  { role: "system", content: mcqSystemPrompt },
                  { role: "user", content: prompt }
              ]);
              return JSON.parse(cleanJson(content || '[]'));
          }, usageType);
      }

      let hindiMcqData = undefined;
      if (language === 'English') {
          try {
             const translatedJson = await translateToHindi(JSON.stringify(data), true, usageType);
             hindiMcqData = JSON.parse(translatedJson);
          } catch(e) { console.error("Translation Failed", e); }
      }

      return {
          id: Date.now().toString(),
          title: `MCQ Test: ${chapter.title}`,
          subtitle: `${data.length} Questions`,
          content: '',
          type: type,
          dateCreated: new Date().toISOString(),
          subjectName: subject.name,
          mcqData: data,
          manualMcqData_HI: hindiMcqData 
      };
  }

  // NOTES Mode
  const generateNotes = async (detailed: boolean): Promise<{text: string, hindiText?: string}> => {
      let prompt = "";
      const template = detailed ? promptNotesPremium : promptNotes;
      
      if (template) {
           prompt = processTemplate(template, {
               board: board || '',
               class: classLevel,
               stream: stream || '',
               subject: subject.name,
               chapter: chapter.title,
               language: language,
               instruction: customInstruction
           });
      } else {
          const competitionConstraints = syllabusMode === 'COMPETITION' 
              ? "STYLE: Fact-Heavy, Direct. HIGHLIGHT PYQs (Previous Year Questions) if relevant." 
              : "STYLE: Strict NCERT Pattern.";

          if (detailed) {
              prompt = `${customInstruction}
              ${adminPromptOverride || ""}
              Write PREMIUM DEEP DIVE NOTES for ${board} Class ${classLevel} ${subject.name}, Chapter: "${chapter.title}".
              Language: ${language}.
              ${competitionConstraints}
              STRICT TARGET: 1000-1500 Words.
              STYLE: "Gemini Style" - Detailed, Conversational, Analytical.
              STRUCTURE:
              1. 🌟 Introduction
              2. 📘 Detailed Explanation
              3. 📊 Text-Based Diagrams / Flowcharts
              4. 🧠 Deep Dive Section
              5. 🧪 Examples & Case Studies
              6. ⚠️ Exam Alerts
              7. 🏆 Topper's Trick
              8. 📝 20 Practice MCQs
              Use bold text for keywords. Make it comprehensive.`;
          } else {
              prompt = `${customInstruction}
              ${adminPromptOverride || ""}
              Write SHORT SUMMARY NOTES for ${board} Class ${classLevel} ${subject.name}, Chapter: "${chapter.title}".
              Language: ${language}.
              STRICT TARGET: 200-300 Words.
              STRUCTURE:
              1. 📌 Basic Definition
              2. 🔑 Key Points
              3. 📝 5 Practice MCQs
              Keep it concise.`;
          }
      }

      const text = await executeWithRotation(async () => {
          if (onStream) {
               return await callGroqApiStream([
                  { role: "system", content: "You are an expert teacher. Provide high quality, well-formatted markdown content." },
                  { role: "user", content: prompt }
               ], onStream);
          }
          return await callGroqApi([
              { role: "system", content: "You are an expert teacher. Provide high quality, well-formatted markdown content." },
              { role: "user", content: prompt }
          ]);
      }, usageType);

      let hindiText = undefined;
      if (language === 'English') {
          try {
              hindiText = await translateToHindi(text, false, usageType);
          } catch(e) { console.error("Translation Failed", e); }
      }
      return { text, hindiText };
  };

  if (dualGeneration && (type === 'NOTES_PREMIUM' || type === 'NOTES_SIMPLE')) {
       const competitionConstraints = syllabusMode === 'COMPETITION' 
          ? "STYLE: Fact-Heavy, Direct. HIGHLIGHT PYQs (Previous Year Questions) if relevant." 
          : "STYLE: Strict NCERT Pattern.";

       const prompt = `${customInstruction}
       ${adminPromptOverride || ""}
       TASK:
       1. Generate Premium Detailed Analysis Notes...
       2. Generate a 200-300 word Summary...
       Language: ${language}.
       ${competitionConstraints}
       OUTPUT FORMAT STRICTLY:
       <<<PREMIUM>>>
       [Content]
       <<<SUMMARY>>>
       [Content]
       `;
       
       const rawText = await executeWithRotation(async () => {
          return await callGroqApi([{ role: "user", content: prompt }]);
       }, usageType);
       
       let premiumText = "";
       let freeText = "";
       
       if (rawText.includes("<<<PREMIUM>>>")) {
           const parts = rawText.split("<<<PREMIUM>>>");
           if (parts[1]) {
               const subParts = parts[1].split("<<<SUMMARY>>>");
               premiumText = subParts[0].trim();
               if (subParts[1]) freeText = subParts[1].trim();
           }
       } else {
           premiumText = rawText;
           freeText = "Summary not generated.";
       }

       let premiumTextHI = undefined;
       let freeTextHI = undefined;
       
       if (language === 'English') {
          try {
              const [p, f] = await Promise.all([
                  translateToHindi(premiumText, false, usageType),
                  translateToHindi(freeText, false, usageType)
              ]);
              premiumTextHI = p;
              freeTextHI = f;
          } catch(e) { console.error("Translation Failed", e); }
       }

      return {
          id: Date.now().toString(),
          title: chapter.title,
          subtitle: "Premium & Free Notes (Dual)",
          content: premiumText,
          type: 'NOTES_PREMIUM',
          dateCreated: new Date().toISOString(),
          subjectName: subject.name,
          schoolPremiumNotesHtml: syllabusMode === 'SCHOOL' ? premiumText : undefined,
          competitionPremiumNotesHtml: syllabusMode === 'COMPETITION' ? premiumText : undefined,
          schoolPremiumNotesHtml_HI: syllabusMode === 'SCHOOL' ? premiumTextHI : undefined,
          competitionPremiumNotesHtml_HI: syllabusMode === 'COMPETITION' ? premiumTextHI : undefined,
          schoolFreeNotesHtml: syllabusMode === 'SCHOOL' ? freeText : undefined,
          competitionFreeNotesHtml: syllabusMode === 'COMPETITION' ? freeText : undefined,
          isComingSoon: false
      };
  }

  const isDetailed = type === 'NOTES_PREMIUM' || type === 'NOTES_HTML_PREMIUM';
  const result = await generateNotes(isDetailed);

  return {
      id: Date.now().toString(),
      title: chapter.title,
      subtitle: isDetailed ? "Premium Study Notes" : "Quick Revision Notes",
      content: result.text,
      type: type,
      dateCreated: new Date().toISOString(),
      subjectName: subject.name,
      schoolPremiumNotesHtml_HI: syllabusMode === 'SCHOOL' && isDetailed ? result.hindiText : undefined,
      competitionPremiumNotesHtml_HI: syllabusMode === 'COMPETITION' && isDetailed ? result.hindiText : undefined,
      isComingSoon: false
  };
};

export const generateTestPaper = async (topics: any, count: number, language: Language): Promise<MCQItem[]> => {
    return []; 
};
export const generateDevCode = async (userPrompt: string): Promise<string> => { return "// Dev Console Disabled"; };

export const generateCustomNotes = async (userTopic: string, adminPrompt: string, modelName: string = "llama3-8b-8192"): Promise<string> => {
    const prompt = `${adminPrompt || 'Generate detailed notes for the following topic:'}\nTOPIC: ${userTopic}\nEnsure the content is well-structured with headings and bullet points.`;
    return await executeWithRotation(async () => {
        return await callGroqApi([{ role: "user", content: prompt }]);
    }, 'STUDENT');
};

export const generateUltraAnalysis = async (
    data: {
        questions: any[], 
        userAnswers: Record<number, number>, 
        score: number, 
        total: number, 
        subject: string, 
        chapter: string, 
        classLevel: string
    },
    settings?: SystemSettings
): Promise<string> => {
    let customInstruction = "";
    if (settings && settings.aiInstruction) customInstruction = settings.aiInstruction;

    const attemptedQuestions = data.questions.map((q, idx) => {
        const selected = data.userAnswers[idx];
        const isCorrect = selected === q.correctAnswer;
        return {
            question: q.question,
            correctAnswer: q.options[q.correctAnswer],
            userSelected: (selected !== undefined && selected !== -1 && q.options[selected]) ? q.options[selected] : "Skipped",
            isCorrect: isCorrect,
            concept: q.concept || q.explanation || "General Concept"
        };
    });

    const prompt = `
    ${customInstruction}
    ROLE: Expert Educational Mentor & Analyst.
    CONTEXT: Student Class: ${data.classLevel}, Subject: ${data.subject}, Chapter: ${data.chapter}, Score: ${data.score}/${data.total}
    TASK: Analyze the student's performance and provide a structured JSON analysis.
    DATA: ${JSON.stringify(attemptedQuestions, null, 2)}
    OUTPUT FORMAT (STRICT JSON ONLY):
    {
      "topics": [{ "name": "Topic Name", "status": "WEAK", "questions": [], "actionPlan": "...", "studyMode": "REVISION" }],
      "motivation": "...",
      "nextSteps": { "duration": "...", "focusTopics": [], "action": "..." },
      "weakToStrongPath": []
    }
    `;

    return await executeWithRotation(async () => {
        const content = await callGroqApi([
            { role: "system", content: "You are a data analyst. Return only valid JSON." },
            { role: "user", content: prompt }
        ]);
        return cleanJson(content || "{}");
    }, 'STUDENT');
};
