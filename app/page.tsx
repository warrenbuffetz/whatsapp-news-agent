export default function Home() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: "40rem" }}>
      <h1>WhatsApp News &amp; Weather Agent</h1>
      <p>
        Serverless backend is running. Twilio webhooks should POST to{" "}
        <code>/api/whatsapp</code>.
      </p>
      <p>
        Text <strong>Good morning</strong> to your Twilio WhatsApp sandbox to
        trigger a morning brief.
      </p>
    </main>
  );
}
