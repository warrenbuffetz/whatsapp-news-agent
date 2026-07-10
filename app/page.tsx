export default function Home() {
  return (
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        padding: "2rem",
        maxWidth: "42rem",
        lineHeight: 1.5,
        color: "#111",
      }}
    >
      <h1 style={{ fontSize: "1.75rem", marginBottom: "0.5rem" }}>
        Market &amp; Run Agents
      </h1>
      <p style={{ marginTop: 0, color: "#444" }}>
        One Vercel deployment, two products. WhatsApp and Telegram deliver the
        same SOXL brief — not separate brief types.
      </p>

      <section style={{ marginTop: "2rem" }}>
        <h2 style={{ fontSize: "1.15rem", marginBottom: "0.35rem" }}>
          SOXL Brief
        </h2>
        <p style={{ marginTop: 0 }}>
          Action brief for Direxion SOXL (3× SOXX): what is driving the basket,
          what happens next session, and what to do if momentum rips or dumps.
        </p>
        <p style={{ marginTop: "0.75rem" }}>
          Live SOXX holdings → impact math → Finnhub (VIX, fundamentals,
          ticker-native news) + optional macro + Reddit. Gemini API (
          <code>gemini-2.5-flash</code>) writes the narrative. Also: top-3 /
          single-name concentration, SOXL vs SOXX/SMH/QQQ, AH/pre gaps, event
          risk (CPI/FOMC/earnings), a code momentum playbook, and a night call
          log. If the Gemini API key hits rate limits, a data-only fallback
          brief still ships with impact, prediction lean, and playbook.
        </p>
        <ul style={{ paddingLeft: "1.25rem" }}>
          <li>
            <strong>Day update</strong> (7 AM ET) — intraday drivers +{" "}
            <em>hold / trim / add / stay flat</em> before the close; protect /
            don&apos;t-chase when the move is already large. No next-session
            prediction.
          </li>
          <li>
            <strong>Nightly update</strong> (5 PM ET) — session wrap,{" "}
            <em>Tomorrow&apos;s prediction</em> or{" "}
            <em>Next week&apos;s prediction on open</em> (Fridays / holidays),
            swing/risk, action plan, and up/down playbook.
          </li>
          <li>
            <strong>Telegram</strong> —{" "}
            <code>/api/soxl/morning</code>, <code>/api/soxl/night</code>;
            multi-part messages tagged (1/n).
          </li>
          <li>
            <strong>WhatsApp</strong> — <em>Good morning</em> →{" "}
            <code>/api/whatsapp</code> (truncated).
          </li>
          <li>
            <strong>Call log</strong> — <code>/api/soxl/calls</code> for recent
            UP/DOWN calls and hit/miss after the next session.
          </li>
        </ul>
      </section>

      <section style={{ marginTop: "1.75rem" }}>
        <h2 style={{ fontSize: "1.15rem", marginBottom: "0.35rem" }}>
          Run Club Coach
        </h2>
        <p style={{ marginTop: 0 }}>
          Anti-excuse Toronto running dial — weather-based gear call and hype
          for the day&apos;s workout. Separate Telegram bot and chat from SOXL.
        </p>
        <ul style={{ paddingLeft: "1.25rem" }}>
          <li>
            <strong>Telegram</strong> — Tue / Thu / Sat at 6 AM ET via{" "}
            <code>/api/run-club</code>
          </li>
        </ul>
      </section>

      <p style={{ marginTop: "2.5rem", fontSize: "0.9rem", color: "#666" }}>
        Status: API routes are live. Configure{" "}
        <code>GEMINI_API_KEY</code> (AI Studio / Gemini <em>API</em> billing —
        not the consumer Gemini Pro chat plan),{" "}
        <code>FINNHUB_API_KEY</code>, and Telegram/Twilio vars in{" "}
        <code>.env.local</code> / Vercel.
      </p>
    </main>
  );
}
