export default async function handler(req, res) {
  // 1. Headers CORS y Checks Iniciales (Estilo coach.js)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // 2. Validación de Entrada
  const { image, mediaType } = req.body || {};

  if (!image) {
    return res.status(400).json({ error: "Se requiere una imagen" });
  }

  const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
  if (!allowedTypes.includes(mediaType)) {
    return res.status(400).json({ error: "Formato de imagen no soportado" });
  }

  // 3. Validación de Tamaño (Límite 5MB)
  // Base64 size approx: (chars * 3) / 4
  const sizeInBytes = (image.length * 3) / 4;
  if (sizeInBytes > 5 * 1024 * 1024) {
    return res.status(413).json({ error: "La imagen supera el límite de 5MB" });
  }

  // 4. Prompts de Visión
  const SYSTEM_PROMPT = `You read text from League of Legends screenshots. You do NOT identify champions by their visual appearance. You only transcribe text that is written on the screen.

Respond ONLY with valid JSON. No markdown fences, no explanation, no commentary.`;

  const USER_PROMPT = `Analyze this League of Legends screenshot. It is either a LOADING SCREEN or a CHAMPION SELECT screen.

── SCREEN TYPE ──
- "loading": two horizontal rows of 5 champion cards each.
- "champion_select": vertical list of 5 champions on the LEFT (user's allies, each with a Spanish lane label: SUPERIOR, JUNGLA, CENTRAL, INFERIOR, SOPORTE) and 5 on the RIGHT (enemies).

── FOR LOADING SCREEN: READ THE CARD TEXT ──

Each card has a full-body splash art. Inside the splash art, directly ABOVE the small circular summoner icon, there is a piece of text. This is either the base champion name OR the skin name (e.g. "El Shascanueces", "Nocturne Eternum", "Shen Amarillo", "PROYECTO: Renekton").

Read ONLY that text. Transcribe it exactly as written. Do NOT interpret, translate, or replace it with anything else. Do NOT look at the splash art visuals.

IGNORE all text that appears BELOW the summoner icon. That text is the player's summoner name or a decorative title (e.g. "Cazador de Caits", "Incendiario", "Ángel Guardián"). It is NOT the champion or skin name.

Read all 10 cards left to right, top row first then bottom row. Return the text you read for each card exactly as it appears.

── FOR CHAMPION SELECT: READ CHAMPION NAMES AND LANES ──

Read the champion name written next to each portrait. Identify the user by the golden/yellow summoner name on the ally list.
Map Spanish lane labels: SUPERIOR → "top", JUNGLA → "jgl", CENTRAL → "mid", INFERIOR → "adc", SOPORTE → "sup".

── CHAMPION NAME FORMAT (champion_select only) ──
Return names in Title Case: "Shaco", "Miss Fortune", "Jarvan IV", "Kai'Sa", "Cho'Gath", "Vel'Koz", "Lee Sin", "Tahm Kench", "Twisted Fate", "Dr. Mundo", "Aurelion Sol", "LeBlanc", "Nunu & Willump", "Bel'Veth", "K'Sante", "Kog'Maw", "Rek'Sai", "Kha'Zix", "Xin Zhao", "Master Yi", "Renata Glasc", "Wukong".

── JSON FORMAT FOR "loading" ──
{
  "screenType": "loading",
  "topRow": ["text from card 1", "text from card 2", "text from card 3", "text from card 4", "text from card 5"],
  "bottomRow": ["text from card 1", "text from card 2", "text from card 3", "text from card 4", "text from card 5"],
  "confidence": "high" | "medium" | "low"
}

── JSON FORMAT FOR "champion_select" ──
{
  "screenType": "champion_select",
  "userChampion": { "champion": "ChampionName", "lane": "top|jgl|mid|adc|sup" },
  "allies": [
    { "champion": "ChampionName", "lane": "top|jgl|mid|adc|sup" },
    { "champion": "ChampionName", "lane": "top|jgl|mid|adc|sup" },
    { "champion": "ChampionName", "lane": "top|jgl|mid|adc|sup" },
    { "champion": "ChampionName", "lane": "top|jgl|mid|adc|sup" }
  ],
  "enemies": [
    { "champion": "ChampionName", "lane": "top|jgl|mid|adc|sup" },
    { "champion": "ChampionName", "lane": "top|jgl|mid|adc|sup" },
    { "champion": "ChampionName", "lane": "top|jgl|mid|adc|sup" },
    { "champion": "ChampionName", "lane": "top|jgl|mid|adc|sup" },
    { "champion": "ChampionName", "lane": "top|jgl|mid|adc|sup" }
  ],
  "confidence": "high" | "medium" | "low"
}

Respond with ONLY the JSON matching the detected screenType. No markdown.`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55000); // 55s para dar margen a Vercel (60s limit)

  try {
    // 5. Llamada a Anthropic Vision (modelo exacto de coach.js)
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2000,
        temperature: 0,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: mediaType,
                  data: image
                }
              },
              {
                type: "text",
                text: USER_PROMPT
              }
            ]
          }
        ],
      }),
      signal: controller.signal,
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || "Error de comunicación con la IA" });
    }

    const aiText = data.content?.map(i => i.text || "").join("\n") || "";

    // 6. Parsing Robust (Patrón optimizado)
    const firstBrace = aiText.indexOf("{");
    let depth = 0;
    let lastBrace = -1;

    if (firstBrace !== -1) {
      for (let i = firstBrace; i < aiText.length; i++) {
        if (aiText[i] === "{") depth++;
        else if (aiText[i] === "}") {
          depth--;
          if (depth === 0) {
            lastBrace = i;
            break;
          }
        }
      }
    }

    if (lastBrace === -1) {
      return res.status(500).json({ error: "No se pudo interpretar la imagen" });
    }

    const parsedJson = JSON.parse(aiText.slice(firstBrace, lastBrace + 1));
    return res.status(200).json(parsedJson);

  } catch (err) {
    if (err.name === "AbortError") {
      return res.status(504).json({ error: "La solicitud excedió el tiempo límite (timeout)." });
    }
    return res.status(500).json({ error: err.message });
  } finally {
    clearTimeout(timeout);
  }
}
