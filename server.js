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
  const { email, prenom, q1, q2, q3, q4, q5, q6, q7a, q7b, q7c, q8, q9, q10, archetype, product } = req.body;

  if (!email || !prenom) {
    return res.status(400).json({ error: 'Email et prénom requis' });
  }

  const priceId = product === 'mindset'
    ? process.env.STRIPE_PRICE_ID_MINDSET
    : process.env.STRIPE_PRICE_ID;

  const truncate = (str, max = 490) => {
    if (!str) return '';
    return String(str).slice(0, max);
  };

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
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

// ─── POST /api/save-lead ─────────────────────────────────────────────────────
app.post('/api/save-lead', async (req, res) => {
  const { prenom, email, archetype, q1, q2, q3, q4, q5, q6, q7a, q7b, q7c, q8, q9, q10 } = req.body;

  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Email invalide' });

  const now = new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });

  const corps = `✦ Nouveau lead — Portrait Djen (sans achat)

Prénom  : ${prenom || '—'}
Email   : ${email}
Archétype : ${archetype || 'non détecté'}
Date    : ${now}

--- RÉPONSES AU QUIZ ---

Q1  : ${q1 || '—'}
Q2  : ${q2 || '—'}
Q3  : ${q3 || '—'}
Q4  : ${q4 || '—'}
Q5  : ${q5 || '—'}
Q6  : ${q6 || '—'}
Q7a : ${q7a || '—'}
Q7b : ${q7b || '—'}
Q7c : ${q7c || '—'}
Q8  : ${q8 || '—'}
Q11 : ${q9 || '—'}
Q13 : ${q10 || '—'}`;

  try {
    await resend.emails.send({
      from: 'La méthode Djen <onboarding@resend.dev>',
      to: process.env.EMAIL_DJEN,
      subject: `✦ Nouveau lead — ${prenom || email} — ${archetype || 'archétype inconnu'}`,
      text: corps,
    });
  } catch (err) {
    console.error('Save-lead email error:', err.message);
  }

  res.json({ success: true });
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

  const isNew = !waitlist.includes(email);

  if (isNew) {
    waitlist.push(email);
    try { fs.writeFileSync(waitlistPath, JSON.stringify(waitlist, null, 2)); } catch {}

    // Notifier Djen
    try {
      await resend.emails.send({
        from: 'La méthode Djen <onboarding@resend.dev>',
        to: process.env.EMAIL_DJEN,
        subject: `✦ Nouvelle inscription waitlist — La Formation Djen`,
        text: `Nouvelle inscription sur la liste d'attente de La Formation Djen.\n\nEmail : ${email}\nTotal inscrits : ${waitlist.length}`,
      });
    } catch (err) {
      console.error('Waitlist email error:', err.message);
    }
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

// ─── GET /api/programme ──────────────────────────────────────────────────────
// Génère et retourne un PDF mini-programme selon l'archétype
app.get('/api/programme', (req, res) => {
  const PDFDocument = require('pdfkit');
  const archetypeRaw = (req.query.archetype || '').toLowerCase();
  const prenom = req.query.prenom || 'toi';

  // Données par archétype
  const programmes = {
    'bâtisseuse': {
      nom: 'La Bâtisseuse Ancrée',
      couleur: [184, 58, 101],
      accroche: 'Tu sais déjà tout. Il est temps que ton corps le sache aussi.',
      cle: 'Ton défi n\'est pas de comprendre — c\'est de ressentir. Passe du savoir au vivre, de la tête au corps.',
      nutrition: [
        'Mange 3 vrais repas assis, sans écran — fais de chaque repas un acte conscient',
        'Ajoute une source de féculents à chaque repas principal (riz, patate douce, pain complet)',
        'Vise +300 à +500 kcal de plus que d\'habitude — note ce que tu manges la 1ère semaine',
        ' 1 collation riche en protéines le soir : fromage blanc, œufs, noix',
      ],
      mindset: [
        'Chaque matin : pose une main sur ton ventre et dis "Je reçois" — 30 secondes',
        'Journaling le soir : "Aujourd\'hui mon corps a reçu…" — 3 lignes minimum',
        'Supprime une source de stress inutile cette semaine (notification, personne, habitude)',
        'Dors 8h minimum — le corps reconstruit la nuit, pas pendant que tu penses',
      ],
      objectif: 'Semaine 1 : sortir de la tête, entrer dans le corps. Pas de perfectionnisme — juste de la régularité.',
    },
    'guerrière': {
      nom: 'La Guerrière Épuisée',
      couleur: [184, 58, 101],
      accroche: 'Tu as tout donné. Il est temps de recevoir.',
      cle: 'Ton cortisol est trop élevé pour que ton corps puisse stocker. Moins d\'effort, plus de résultats.',
      nutrition: [
        'Ajoute des graisses saines à chaque repas : avocat, huile d\'olive, beurre de cacahuète',
        'Mange avant l\'entraînement ET après — ton corps a besoin de carburant des deux côtés',
        'Supprime les séances cardio intensives cette semaine — elles brûlent ce que tu veux garder',
        'Tisane d\'ashwagandha ou de réglisse le soir — pour baisser le cortisol',
      ],
      mindset: [
        'Une sieste de 20 min par jour si possible — la récupération est ton entraînement cette semaine',
        'Dis "non" à une chose cette semaine qui te coûte de l\'énergie sans te nourrir',
        'Remplace une séance de sport par une marche douce ou du yoga',
        'Écris chaque soir : "Ce que j\'ai reçu aujourd\'hui" — entraîne-toi à recevoir',
      ],
      objectif: 'Semaine 1 : baisser le cortisol. Moins d\'intensité, plus de douceur — ton corps te remerciera.',
    },
    'déesse': {
      nom: 'La Déesse Invisible',
      couleur: [184, 58, 101],
      accroche: 'Ta puissance est là. Elle a toujours été là.',
      cle: 'Ton corps reflète la place que tu t\'autorises à prendre. Plus tu t\'affiches, plus il répond.',
      nutrition: [
        'Cuisine un plat que TU aimes cette semaine — pas ce que les autres veulent manger',
        'Mange à table, assis·e, avec une belle assiette — honore ce que tu te donnes',
        'Augmente les protéines : viande, poisson, légumineuses à chaque repas principal',
        'Autorise-toi les aliments "plaisir" — les interdits nourrissent le stress, pas le corps',
      ],
      mindset: [
        'Chaque matin : regarde-toi dans le miroir et nomme 3 choses que tu aimes dans ton corps',
        'Habille-toi pour toi cette semaine — pas pour disparaître, pour exister',
        'Prends de la place physiquement : étire-toi, marche lentement, parle plus fort',
        'Écris : "Je mérite d\'avoir le corps que je veux parce que…" — 5 raisons',
      ],
      objectif: 'Semaine 1 : s\'autoriser à exister pleinement. Ton corps suit ton énergie.',
    },
    'stratège': {
      nom: 'La Stratège Impatiente',
      couleur: [184, 58, 101],
      accroche: 'Tu as l\'intelligence. Donne-lui une méthode à suivre.',
      cle: 'Tu comprends tout vite — mais la transformation demande du temps. Ta mission : faire confiance au processus.',
      nutrition: [
        'Calcule ton surplus calorique cible : poids actuel (kg) × 33 + 300 kcal = objectif journalier',
        'Répartis les repas en 3 + 2 collations — structure ton alimentation comme un programme',
        'Track tes macros la 1ère semaine : 30% protéines, 40% glucides, 30% lipides',
        'Pèse-toi 1x par semaine seulement (le matin à jeun) — pas plus, cela biaise l\'analyse',
      ],
      mindset: [
        'Définis ton indicateur de succès de la semaine (pas le poids — une habitude tenue)',
        'Si tu ressens de l\'impatience : écris "Ce qui s\'est amélioré depuis 7 jours" — prouve-toi le progrès',
        'Méditation de 5 min le matin — juste observer, sans analyser',
        'Règle : pas de changement de plan avant 3 semaines complètes',
      ],
      objectif: 'Semaine 1 : poser les bases, suivre le plan sans modifier. L\'analyse vient à la semaine 4.',
    },
    'nourricière': {
      nom: 'La Nourricière Oubliée',
      couleur: [184, 58, 101],
      accroche: 'Tu donnes à tout le monde. C\'est ton tour.',
      cle: 'Tu ne peux pas te nourrir des miettes qui restent. Tu passes en premier cette semaine.',
      nutrition: [
        'Prépare ton repas AVANT de cuisiner pour les autres — tu es la priorité',
        'Mange des aliments qui te font vraiment plaisir — pas ce qui est pratique pour tout le monde',
        'Augmente les portions : une assiette pleine, pas une demi-portion en vitesse',
        'Ashwagandha + fenugrec en complément — pour l\'appétit et la récupération hormonale',
      ],
      mindset: [
        'Chaque matin : 15 minutes pour toi avant de penser aux autres (café, lecture, silence)',
        'Dis à voix haute : "Prendre soin de moi me rend meilleure pour les autres"',
        'Planifie tes repas de la semaine comme tu planifies ceux de ta famille',
        'Écris : "Cette semaine je me donne la permission de…" — et tiens-le',
      ],
      objectif: 'Semaine 1 : te mettre en premier. Une seule fois. Recommence la semaine suivante.',
    },
    'phœnix': {
      nom: 'La Phœnix en Reconstruction',
      couleur: [184, 58, 101],
      accroche: 'Tu reviens. Et ce que tu construis maintenant te ressemble enfin.',
      cle: 'Pas de retour à l\'avant. Tu construis quelque chose de nouveau, sur des bases solides.',
      nutrition: [
        'Commence simple : 3 repas fixes par jour, même heure — réinstalle la routine',
        'Aliments de reconstruction : œufs, riz, banane, avocat, légumes cuits — doux et nourrissants',
        'Hydrate-toi bien : 2L d\'eau par jour — le corps reconstruit avec de l\'eau',
        'Un seul objectif nutritionnel cette semaine : ne sauter aucun repas',
      ],
      mindset: [
        'Journaling chaque soir : "Une chose que j\'ai faite pour moi aujourd\'hui"',
        'Coupe les comparaisons avec ton avant — tu es une version différente maintenant',
        'Choisis une phrase qui résume qui tu deviens — écris-la quelque part que tu vois chaque matin',
        'Autorise-toi d\'être en reconstruction — ce n\'est pas une faiblesse, c\'est du courage',
      ],
      objectif: 'Semaine 1 : poser les fondations doucement. La vitesse vient après la solidité.',
    },
  };

  // Trouver l'archétype correspondant
  let archetypeKey = null;
  for (const key of Object.keys(programmes)) {
    if (archetypeRaw.includes(key)) { archetypeKey = key; break; }
  }
  if (!archetypeKey) archetypeKey = 'bâtisseuse'; // fallback

  const prog = programmes[archetypeKey];
  const [r, g, b] = prog.couleur;

  const doc = new PDFDocument({ size: 'A4', margin: 50 });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="programme-djen-${archetypeKey}.pdf"`);
  doc.pipe(res);

  // ── HEADER ──
  doc.rect(0, 0, doc.page.width, 120).fill(`rgb(${r},${g},${b})`);
  doc.fillColor('#ffffff')
     .font('Helvetica-Bold').fontSize(11).text('LA MÉTHODE DJEN', 50, 32, { characterSpacing: 3 });
  doc.font('Helvetica').fontSize(9).fillColor('rgba(255,255,255,0.7)')
     .text('Mini-programme — Semaine 1', 50, 50);
  doc.font('Helvetica-Bold').fontSize(22).fillColor('#ffffff')
     .text(prog.nom, 50, 68);

  // ── ACCROCHE ──
  doc.moveDown(4);
  doc.fillColor(`rgb(${r},${g},${b})`).font('Helvetica-Oblique').fontSize(14)
     .text(`"${prog.accroche}"`, { align: 'center' });
  doc.moveDown(0.5);
  doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).strokeColor(`rgb(${r},${g},${b})`).lineWidth(0.5).stroke();

  // ── CLÉ ──
  doc.moveDown(1);
  doc.fillColor('#333').font('Helvetica-Bold').fontSize(10).text('TA CLÉ CETTE SEMAINE', { characterSpacing: 2 });
  doc.moveDown(0.3);
  doc.fillColor('#555').font('Helvetica').fontSize(11).text(prog.cle, { lineGap: 4 });

  // ── NUTRITION ──
  doc.moveDown(1.2);
  doc.rect(50, doc.y, doc.page.width - 100, 22).fill(`rgb(${r},${g},${b})`);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(10)
     .text('NUTRITION — CE QUE TU MANGES', 58, doc.y - 17, { characterSpacing: 1.5 });
  doc.moveDown(0.8);
  prog.nutrition.forEach((item, i) => {
    doc.fillColor(`rgb(${r},${g},${b})`).font('Helvetica-Bold').fontSize(11).text(`${i + 1}.  `, { continued: true });
    doc.fillColor('#333').font('Helvetica').fontSize(11).text(item, { lineGap: 3 });
    doc.moveDown(0.3);
  });

  // ── MINDSET ──
  doc.moveDown(0.8);
  doc.rect(50, doc.y, doc.page.width - 100, 22).fill(`rgb(${r},${g},${b})`);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(10)
     .text('MINDSET — CE QUE TU TRAVAILLES', 58, doc.y - 17, { characterSpacing: 1.5 });
  doc.moveDown(0.8);
  prog.mindset.forEach((item, i) => {
    doc.fillColor(`rgb(${r},${g},${b})`).font('Helvetica-Bold').fontSize(11).text(`${i + 1}.  `, { continued: true });
    doc.fillColor('#333').font('Helvetica').fontSize(11).text(item, { lineGap: 3 });
    doc.moveDown(0.3);
  });

  // ── OBJECTIF SEMAINE ──
  doc.moveDown(1);
  doc.rect(50, doc.y, doc.page.width - 100, 1).fill(`rgb(${r},${g},${b})`);
  doc.moveDown(0.5);
  doc.fillColor(`rgb(${r},${g},${b})`).font('Helvetica-Bold').fontSize(10).text('OBJECTIF SEMAINE 1', { characterSpacing: 2 });
  doc.moveDown(0.3);
  doc.fillColor('#333').font('Helvetica-Oblique').fontSize(11).text(prog.objectif);

  // ── FOOTER ──
  const footerY = doc.page.height - 60;
  doc.rect(0, footerY, doc.page.width, 60).fill(`rgb(${r},${g},${b})`);
  doc.fillColor('#ffffff').font('Helvetica').fontSize(9)
     .text('lamethodedjen.com', 50, footerY + 20);
  doc.fillColor('rgba(255,255,255,0.6)').fontSize(8)
     .text('Ce programme est un point de départ. Pour aller plus loin : L\'Empreinte Djen ou La Formation Djen.', 50, footerY + 36, { width: doc.page.width - 100 });

  doc.end();
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
