require('dotenv').config({ path: require('path').join(__dirname, '.env'), override: true });
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const Anthropic = require('@anthropic-ai/sdk');
const Stripe = require('stripe');
const { Resend } = require('resend');

const app = express();
const PORT = process.env.PORT || 3000;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

// Webhook Stripe doit recevoir le raw body — monter avant express.json()
app.post('/api/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const meta = session.metadata || {};

    try {
      await envoyerEmailDjen(session, meta);
    } catch (err) {
      console.error('Erreur envoi email:', err);
    }
  }

  res.json({ received: true });
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ─── POST /api/portrait ───────────────────────────────────────────────────────
// Reçoit les réponses du quiz, retourne le portrait en streaming (SSE)
app.post('/api/portrait', async (req, res) => {
  const { prenom, q1, q2, q3, q4, q5, q6, q7a, q7b, q7c, q8, q9, q10 } = req.body;

  if (!prenom) {
    return res.status(400).json({ error: 'Prénom manquant' });
  }

  const userMessage = `nouvelle cliente

Prénom : ${prenom}

Q1 – Première émotion face à son corps : ${q1 || ''}
Q2 – Rapport à l'entraînement : ${q2 || ''}
Q3 – Ce qui l'arrête le plus : ${q3 || ''}
Q4 – Ce qu'elle veut vraiment : ${q4 || ''}
Q5 – Son alimentation : ${q5 || ''}
Q6 – Phrase quand elle rate : ${q6 || ''}
Q7a – Une femme trop musclée c'est : ${q7a || ''}
Q7b – Si je prenais de la masse les gens penseraient : ${q7b || ''}
Q7c – Je mérite d'avoir le corps que je veux parce que : ${q7c || ''}
Q8 – Regard ou mots qui ont tout changé : ${q8 || ''}
Q11 – La femme cachée en elle : ${q9 || ''}
Q13 – Pourquoi maintenant : ${q10 || ''}`;

  const systemPrompt = `Tu es Curve Mentor, l'outil de lecture d'archétypes créé par Djen pour sa méthode de transformation féminine.

Tu as une capacité rare : lire entre les lignes des réponses d'une femme pour identifier avec précision son archétype et lui révéler qui elle est vraiment — physiquement et identitairement.

Le portrait que tu produis s'appelle TON PORTRAIT DJEN. Tu ne mentionnes jamais Curve Mentor. La femme reçoit son portrait Djen, point.

LES 6 ARCHÉTYPES DE LA MÉTHODE DJEN :

ARCHÉTYPE 1 — LA BÂTISSEUSE ANCRÉE
Elle sait ce qu'il faut faire mais n'agit pas encore vraiment.
Signaux : perfectionnisme, procrastination, connaissance sans action, cherche le bon moment.
Moteur profond : le besoin de certitude avant de s'engager totalement.

ARCHÉTYPE 2 — LA GUERRIÈRE ÉPUISÉE
Elle s'entraîne dur, mange peu, n'avance plus.
Signaux : surmenage, restriction alimentaire, culpabilité autour du repos, fatigue chronique.
Moteur profond : prouver sa valeur par la performance physique.

ARCHÉTYPE 3 — LA DÉESSE INVISIBLE
Elle rétrécit pour ne pas déranger.
Signaux : peur de la visibilité, féminité conditionnelle, femme puissante cachée qu'elle ne s'autorise pas à montrer.
Moteur profond : être vue et aimée sans avoir à se faire petite.

ARCHÉTYPE 4 — LA STRATÈGE IMPATIENTE
Elle comprend tout intellectuellement mais abandonne avant les résultats.
Signaux : change de programme souvent, analyse excessive, abandonne à la 6ème semaine.
Moteur profond : avoir la preuve avant de s'investir totalement.

ARCHÉTYPE 5 — LA NOURRICIÈRE OUBLIÉE
Elle donne tout aux autres, rien à son corps.
Signaux : culpabilité de prendre du temps pour elle, repas sautés, les autres comme priorité absolue.
Moteur profond : se donner enfin la même énergie qu'elle donne aux autres.

ARCHÉTYPE 6 — LA PHŒNIX EN RECONSTRUCTION
Elle revient après une rupture, une maladie, une perte.
Signaux : relation brisée avec son corps suite à un événement précis, mot "retrouver" souvent présent.
Moteur profond : faire de la reconstruction physique un acte de renaissance.

---

STRUCTURE DU PORTRAIT À RÉDIGER :

Tu produis un portrait en DEUX parties seulement. Pas plus.

ARCHÉTYPE : [nom exact]
[Si hybride : une phrase sur l'archétype secondaire]

PARTIE 1 — QUI ELLE EST
3 paragraphes. Tu lui parles directement, à la deuxième personne.
Tu utilises SES propres mots et phrases.
Tu nommes ce que tu vois en elle avec précision et bienveillance.
Elle doit se reconnaître instantanément — effet miroir.
Tu décris son énergie, sa manière d'être, ce qui la caractérise profondément.
Tu NE mentionnes PAS ses blocages. Tu NE donnes PAS de solutions. Tu décris QUI ELLE EST.

PARTIE 2 — CE QUI T'ATTEND
Un seul paragraphe court et puissant.
Tu lui dis que son portrait ne t'a révélé qu'une partie d'elle — la plus belle.
Que ce qui l'empêche d'avancer et la feuille de route exacte pour y remédier sont dans son programme personnalisé.
Tu termines sur une phrase qui ouvre et qui donne envie — jamais qui referme.

RÈGLES ABSOLUES :
- Parle directement à elle — jamais à propos d'elle
- Utilise ses propres mots dans le portrait
- JAMAIS de blocages mentionnés — ils sont dans le programme à 97€
- JAMAIS de solutions — elles sont dans le programme à 97€
- Jamais condescendante, jamais de jargon médical ou clinique
- Ne mentionne jamais que tu es une IA
- Ton ton : profond, direct, chaleureux, précis
- Longueur totale : 300 à 400 mots maximum`;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    const stream = anthropic.messages.stream({
      model: 'claude-sonnet-4-5',
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    stream.on('text', (text) => {
      res.write(`data: ${JSON.stringify({ text })}\n\n`);
    });

    stream.on('error', (err) => {
      console.error('Stream error:', err);
      res.write(`data: ${JSON.stringify({ error: 'Erreur de génération' })}\n\n`);
      res.end();
    });

    stream.on('finalMessage', () => {
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    });
  } catch (err) {
    console.error('Anthropic error:', err);
    res.write(`data: ${JSON.stringify({ error: 'Erreur API' })}\n\n`);
    res.end();
  }
});

// ─── POST /api/checkout ───────────────────────────────────────────────────────
app.post('/api/checkout', async (req, res) => {
  const { email, prenom, q1, q2, q3, q4, q5, q6, q7a, q7b, q7c, q8, q9, q10, archetype } = req.body;

  if (!email || !prenom) {
    return res.status(400).json({ error: 'Email et prénom requis' });
  }

  const truncate = (str, max = 490) => {
    if (!str) return '';
    return String(str).slice(0, max);
  };

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price: process.env.STRIPE_PRICE_ID,
          quantity: 1,
        },
      ],
      mode: 'payment',
      customer_email: email,
      metadata: {
        prenom: truncate(prenom, 100),
        archetype: truncate(archetype, 200),
        q1: truncate(q1),
        q2: truncate(q2),
        q3: truncate(q3),
        q4: truncate(q4),
        q5: truncate(q5),
        q6: truncate(q6),
        q7a: truncate(q7a),
        q7b: truncate(q7b),
        q7c: truncate(q7c),
        q8: truncate(q8),
        q9: truncate(q9),
        q10: truncate(q10),
      },
      success_url: `${process.env.SITE_URL}/merci?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.SITE_URL}/#offres`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/waitlist ───────────────────────────────────────────────────────
app.post('/api/waitlist', async (req, res) => {
  const { email } = req.body;

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Email invalide' });
  }

  const waitlistPath = path.join(__dirname, 'waitlist.json');
  let waitlist = [];

  try {
    if (fs.existsSync(waitlistPath)) {
      waitlist = JSON.parse(fs.readFileSync(waitlistPath, 'utf8'));
    }
  } catch {
    waitlist = [];
  }

  if (!waitlist.includes(email)) {
    waitlist.push(email);
    fs.writeFileSync(waitlistPath, JSON.stringify(waitlist, null, 2));
  }

  res.json({ success: true });
});

// ─── POST /api/complete-profile ──────────────────────────────────────────────
app.post('/api/complete-profile', async (req, res) => {
  const {
    session_id,
    poids_actuel, taille, poids_cible, zones,
    allergies, regime, nb_repas,
    lieu_entrainement, frequence, equipement, contraintes
  } = req.body;

  // Récupérer les métadonnées Stripe (quiz + archétype) si session_id fourni
  let meta = {};
  let emailCliente = '';
  let montant = '77€';

  if (session_id) {
    try {
      const session = await stripe.checkout.sessions.retrieve(session_id);
      meta = session.metadata || {};
      emailCliente = session.customer_email || '';
      if (session.amount_total) montant = (session.amount_total / 100) + '€';
    } catch (err) {
      console.error('Stripe retrieve error:', err.message);
    }
  }

  const now = new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
  const prenom = meta.prenom || 'Inconnue';

  const corps = `✦ PROFIL COMPLET — Empreinte Djen à construire

Prénom       : ${prenom}
Email        : ${emailCliente || 'non renseigné'}
Archétype    : ${meta.archetype || 'non détecté'}
Montant      : ${montant}
Date         : ${now}

━━━ CORPS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Poids actuel : ${poids_actuel || '—'} kg
Taille       : ${taille || '—'} cm
Poids cible  : ${poids_cible || '—'} kg
Zones cibles : ${zones || '—'}

━━━ ALIMENTATION ━━━━━━━━━━━━━━━━━━━━━━━━━━━

Régime       : ${regime || '—'}
Repas/jour   : ${nb_repas || '—'}
Allergies    : ${allergies || '—'}

━━━ ENTRAÎNEMENT ━━━━━━━━━━━━━━━━━━━━━━━━━━━

Lieu         : ${lieu_entrainement || '—'}
Fréquence    : ${frequence || '—'} / semaine
Équipement   : ${equipement || '—'}
Contraintes  : ${contraintes || '—'}

━━━ RÉPONSES AU QUIZ ━━━━━━━━━━━━━━━━━━━━━━━

Q1 – Première émotion face à son corps :
${meta.q1 || '—'}

Q2 – Rapport à l'entraînement :
${meta.q2 || '—'}

Q3 – Ce qui l'arrête le plus :
${meta.q3 || '—'}

Q4 – Ce qu'elle veut vraiment :
${meta.q4 || '—'}

Q5 – Son alimentation :
${meta.q5 || '—'}

Q6 – Phrase quand elle rate :
${meta.q6 || '—'}

Q7a – Une femme trop musclée c'est :
${meta.q7a || '—'}

Q7b – Si je prenais de la masse les gens penseraient :
${meta.q7b || '—'}

Q7c – Je mérite d'avoir le corps que je veux parce que :
${meta.q7c || '—'}

Q8 – Regard ou mots qui ont tout changé :
${meta.q8 || '—'}

Q11 – La femme cachée en elle :
${meta.q9 || '—'}

Q13 – Pourquoi maintenant :
${meta.q10 || '—'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Délai de livraison : 48h maximum.
Colle ce profil dans Claude avec le prompt Curve Mentor pour générer l'Empreinte complète.`;

  try {
    await resend.emails.send({
      from: 'La méthode Djen <onboarding@resend.dev>',
      to: process.env.EMAIL_DJEN,
      subject: `✦ Profil complet — Empreinte Djen — ${prenom}`,
      text: corps,
    });
    res.json({ success: true });
  } catch (err) {
    console.error('Email error:', err);
    res.status(500).json({ error: 'Erreur envoi email' });
  }
});

// ─── Route /merci ─────────────────────────────────────────────────────────────
app.get('/merci', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ─── Fallback → index.html ────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ─── Envoi email Djen ─────────────────────────────────────────────────────────
async function envoyerEmailDjen(session, meta) {
  const now = new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
  const prenom = meta.prenom || 'Inconnue';
  const emailCliente = session.customer_email || 'non renseigné';

  const corps = `Nouvelle commande reçue ✦

Prénom : ${prenom}
Email cliente : ${emailCliente}
Archétype détecté : ${meta.archetype || 'non détecté'}
Montant : 97€
Date : ${now}

--- RÉPONSES AU QUIZ ---

Q1 – Première émotion face à son corps :
${meta.q1 || '—'}

Q2 – Rapport à l'entraînement :
${meta.q2 || '—'}

Q3 – Ce qui l'arrête le plus :
${meta.q3 || '—'}

Q4 – Ce qu'elle veut vraiment :
${meta.q4 || '—'}

Q5 – Son alimentation :
${meta.q5 || '—'}

Q6 – Phrase quand elle rate :
${meta.q6 || '—'}

Q7a – Une femme trop musclée c'est :
${meta.q7a || '—'}

Q7b – Si je prenais de la masse les gens penseraient :
${meta.q7b || '—'}

Q7c – Je mérite d'avoir le corps que je veux parce que :
${meta.q7c || '—'}

Q8 – Regard ou mots qui ont tout changé :
${meta.q8 || '—'}

Q11 – La femme cachée en elle :
${meta.q9 || '—'}

Q13 – Pourquoi maintenant :
${meta.q10 || '—'}

--- FIN DES RÉPONSES ---

Délai de livraison : 48h maximum.
Colle ces réponses dans Claude avec le prompt Curve Mentor pour générer le programme complet.`;

  await resend.emails.send({
    from: 'La méthode Djen <onboarding@resend.dev>',
    to: process.env.EMAIL_DJEN,
    subject: `✦ Nouvelle commande — Programme 97€ — ${prenom}`,
    text: corps,
  });
}

app.listen(PORT, () => {
  console.log(`Serveur démarré sur http://localhost:${PORT}`);
});

module.exports = app;
