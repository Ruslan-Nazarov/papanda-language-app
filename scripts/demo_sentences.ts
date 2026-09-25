import { buildSentenceGenerationPrompt, getSeedWords, getAllDictionaryCandidates, SENTENCE_ARRAY_SCHEMA } from "../src/services/sentencePrompts";
import { Word } from "../src/models/types";

const PROXY_URL = "https://papanda-gemini-proxy.papanda-runaz.workers.dev/v1/generate";

const MOCK_WORDS: Partial<Word>[] = [
  { id: "1", translations: { en: "house" }, ru: "дом" },
  { id: "2", translations: { en: "dog" }, ru: "собака" },
  { id: "3", translations: { en: "read" }, ru: "читать" },
  { id: "4", translations: { en: "buy" }, ru: "покупать" },
  { id: "5", translations: { en: "city" }, ru: "город" },
  { id: "6", translations: { en: "book" }, ru: "книга" },
  { id: "7", translations: { en: "friend" }, ru: "друг" },
  { id: "8", translations: { en: "work" }, ru: "работать" },
  { id: "9", translations: { en: "car" }, ru: "машина" },
  { id: "10", translations: { en: "eat" }, ru: "есть" },
  { id: "11", translations: { en: "mother" }, ru: "мать" },
  { id: "12", translations: { en: "water" }, ru: "вода" },
  { id: "13", translations: { en: "write" }, ru: "писать" },
  { id: "14", translations: { en: "school" }, ru: "школа" },
  { id: "15", translations: { en: "child" }, ru: "ребёнок" },
  { id: "16", translations: { en: "walk" }, ru: "идти" },
  { id: "17", translations: { en: "tree" }, ru: "дерево" },
  { id: "18", translations: { en: "street" }, ru: "улица" },
  { id: "19", translations: { en: "morning" }, ru: "утро" },
  { id: "20", translations: { en: "teacher" }, ru: "учитель" },
  { id: "21", translations: { en: "open" }, ru: "открывать" },
  { id: "22", translations: { en: "give" }, ru: "давать" },
  { id: "23", translations: { en: "door" }, ru: "дверь" },
  { id: "24", translations: { en: "help" }, ru: "помогать" },
  { id: "25", translations: { en: "letter" }, ru: "письмо" },
  { id: "26", translations: { en: "phone" }, ru: "телефон" },
  { id: "27", translations: { en: "window" }, ru: "окно" },
  { id: "28", translations: { en: "ask" }, ru: "спрашивать" },
  { id: "29", translations: { en: "know" }, ru: "знать" },
  { id: "30", translations: { en: "table" }, ru: "стол" },
  { id: "31", translations: { en: "coffee" }, ru: "кофе" },
  { id: "32", translations: { en: "answer" }, ru: "отвечать" },
  { id: "33", translations: { en: "money" }, ru: "деньги" },
  { id: "34", translations: { en: "park" }, ru: "парк" },
  { id: "35", translations: { en: "speak" }, ru: "говорить" },
  { id: "36", translations: { en: "run" }, ru: "бежать" },
  { id: "37", translations: { en: "shop" }, ru: "магазин" },
  { id: "38", translations: { en: "bring" }, ru: "приносить" },
  { id: "39", translations: { en: "student" }, ru: "студент" },
  { id: "40", translations: { en: "learn" }, ru: "учиться" },
  { id: "41", translations: { en: "garden" }, ru: "сад" },
  { id: "42", translations: { en: "sleep" }, ru: "спать" },
  { id: "43", translations: { en: "flower" }, ru: "цветок" },
  { id: "44", translations: { en: "key" }, ru: "ключ" },
  { id: "45", translations: { en: "doctor" }, ru: "врач" },
  { id: "46", translations: { en: "old" }, ru: "старый" },
  { id: "47", translations: { en: "new" }, ru: "новый" },
  { id: "48", translations: { en: "big" }, ru: "большой" },
  { id: "49", translations: { en: "small" }, ru: "маленький" },
  { id: "50", translations: { en: "fast" }, ru: "быстрый" },
];

async function main() {
  const words = MOCK_WORDS as Word[];
  const seeds = getSeedWords(words, "en", 25);
  const allCandidates = getAllDictionaryCandidates(words, "en");

  console.log("\n=== SEED WORDS (25 random) ===");
  seeds.forEach(s => console.log("  - " + s.lemma + " — " + s.translation));
  console.log("\n=== FULL DICTIONARY: " + allCandidates.length + " words ===\n");

  const prompt = buildSentenceGenerationPrompt("en", seeds, 3);
  console.log("=== CALLING API... ===\n");

  const response = await fetch(PROXY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Install-Id": "demo-script" },
    body: JSON.stringify({ prompt, generationConfig: { temperature: 0.80, topP: 0.92, responseMimeType: "application/json", responseSchema: SENTENCE_ARRAY_SCHEMA } })
  });

  const data = await response.json() as { text?: string; error?: string };
  if (!data.text) { console.error("API error:", data.error || response.status); process.exit(1); }

  console.log("=== RAW RESPONSE (first 2000 chars) ===");
  console.log(data.text.slice(0, 2000));
  console.log("\n=== END RAW ===\n");

  let parsed: any = JSON.parse(data.text);
  // The model sometimes wraps the array in an object, or returns a single object
  let sentences: any[] = [];
  if (Array.isArray(parsed)) {
    sentences = parsed;
  } else if (parsed.sentences && Array.isArray(parsed.sentences)) {
    sentences = parsed.sentences;
  } else if (parsed.sentence && typeof parsed.sentence === 'string') {
    sentences = [parsed];
  } else if (parsed.data && Array.isArray(parsed.data)) {
    sentences = parsed.data;
  } else {
    sentences = Array.isArray(Object.values(parsed)[0]) ? Object.values(parsed)[0] as any[] : [];
  }

  console.log("=== GENERATED SENTENCES ===\n");
  sentences.forEach((s: any, i: number) => {
    console.log((i+1) + ". " + s.sentence);
    const dictWords = (s.words || []).filter((w: any) => w.is_in_my_dict).map((w: any) => w.text + "(" + w.dictionary_word + ")").join(", ");
    console.log("   Seed hits: " + (dictWords || "(none)"));
    const roles = (s.words || []).map((w: any) => w.text + "[" + w.role + "]").join(" ");
    console.log("   Structure: " + roles);
    console.log();
  });
}

main().catch(console.error);
