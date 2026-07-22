const MODEL = "gemini-flash-latest";
const MAX_NOTES_LENGTH = 6000; // characters — keeps requests small, fast, and cheap

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  let notes;
  try {
    const body = JSON.parse(event.body || "{}");
    notes = (body.notes || "").trim();
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid request body." }) };
  }

  if (!notes) {
    return { statusCode: 400, body: JSON.stringify({ error: "Paste some notes first." }) };
  }
  if (notes.length > MAX_NOTES_LENGTH) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: `Notes are too long — keep it under ${MAX_NOTES_LENGTH} characters.` })
    };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "Server is missing its API key." }) };
  }

  const prompt = `You are helping a premed student turn their MCAT study notes into flashcards.
Read the notes below and produce 5 to 10 flashcards, each a concise question paired with a concise answer, testing the key facts, mechanisms, or relationships in the notes. Do not invent facts that aren't supported by the notes.
Return ONLY valid JSON, with no markdown formatting and no code fences: an array of objects, each with a "question" key and an "answer" key.

Notes:
"""
${notes}
"""`;

  try {
    // Uses the x-goog-api-key header rather than a ?key= URL param — the
    // newer "Auth key" format (starting with "AQ.") that Google AI Studio
    // now issues by default needs this method. If Google's rollout shifts
    // again and this stops working, check https://ai.google.dev/gemini-api/docs/api-key
    // for the current requirement.
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.4 }
        })
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      return {
        statusCode: 502,
        body: JSON.stringify({ error: "The AI service didn't respond as expected.", detail: errText.slice(0, 300) })
      };
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const cleaned = text.replace(/```json|```/g, "").trim();

    let flashcards;
    try {
      flashcards = JSON.parse(cleaned);
    } catch (e) {
      return { statusCode: 502, body: JSON.stringify({ error: "Couldn't parse flashcards from the AI response. Try again." }) };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flashcards })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: "Something went wrong generating flashcards." }) };
  }
};
