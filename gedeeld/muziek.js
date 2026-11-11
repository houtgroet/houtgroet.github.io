/* K24 kerstmuziek (10-11-2026): Claude speelt zelf de melodie af met de Web Audio API van de browser.
 *
 * Geen geluidsbestanden, geen rechten van anderen: de LIEDJES zijn publiek domein (Jingle Bells, J. Pierpont 1857;
 * Stille Nacht, F. X. Gruber 1818) en de KLANK wordt hier zelf berekend. Werkt op gsm na een tik (browserregel).
 *
 * Gebruik:  const stop = KerstMuziek.speel(audioContext, 'jinglebells', 'speeldoos', {herhaal: true});
 *           stop();   // fade-out
 *           KerstMuziek.duur('jinglebells')  -> seconden
 * Klanken:  'speeldoos' = metalen tongetjes (grondtoon + boventonen, snelle aanslag, lange uitsterving)
 *           'belletjes' = klokkenspel (onharmonische boventonen zoals een staafklok) + sleebelletjes (gefilterde ruis)
 * Werkt met een gewone AudioContext én een OfflineAudioContext (voor de controle zonder luidsprekers).
 *
 * Filmpje (10-11, storyboard v3.1): opties {intro: 2, zwelling: {van: 7, tot: 9, factor: 2.5}, slot: true};
 *   G1 (11-11, geluidskeuring): + {belklank: 'metaal', opvullen: true, volume: ...} (zonder = oude klank, muziekproef/animatic)
 *   de teruggegeven stop-functie heeft .start (audioklok, begin intro), .maatDuur en .geluid.laser/.fonkel/.tinkel
 *   om geluidjes op exacte tijden onder de muziek te leggen. iPhone-stilteknop: audioSession 'playback'.
 */
(function (globaal) {
  'use strict';

  /* ---- Noten: naam -> frequentie (gelijkzwevend, A4 = 440 Hz) ---- */
  const HALVE_TONEN = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 };
  function frequentie(noot) {
    const m = /^([A-G])(#?)(\d)$/.exec(noot);
    const n = HALVE_TONEN[m[1]] + (m[2] ? 1 : 0) + (Number(m[3]) - 4) * 12;
    return 440 * Math.pow(2, n / 12);
  }

  /** Zet "E5:1 G5:0.5 ..." om naar [{noot, tellen}] ('-' = rust). */
  function reeks(tekst) {
    return tekst.trim().split(/\s+/).map((t) => { const [noot, tel] = t.split(':'); return { noot, tellen: Number(tel) }; });
  }

  /* ---- Liedjes (publiek domein). Melodie + per maat een akkoord (grondtoon voor de bas, terts/kwint zacht). ---- */
  const LIEDJES = {
    jinglebells: {
      titel: 'Jingle Bells (refrein)',
      tempo: 116,                      // tellen per minuut
      maat: 4,
      melodie: reeks(`
        E5:1 E5:1 E5:2   E5:1 E5:1 E5:2   E5:1 G5:1 C5:1.5 D5:0.5   E5:4
        F5:1 F5:1 F5:1.5 F5:0.5   F5:1 E5:1 E5:1 E5:0.5 E5:0.5   E5:1 D5:1 D5:1 E5:1   D5:2 G5:2
        E5:1 E5:1 E5:2   E5:1 E5:1 E5:2   E5:1 G5:1 C5:1.5 D5:0.5   E5:4
        F5:1 F5:1 F5:1.5 F5:0.5   F5:1 E5:1 E5:1 E5:0.5 E5:0.5   G5:1 G5:1 F5:1 D5:1   C5:4`),
      akkoorden: 'C C C C F C G G C C C C F C G C'.split(' '),
    },
    stillenacht: {
      titel: 'Stille Nacht',
      tempo: 92,
      maat: 3,
      melodie: reeks(`
        G4:1.5 A4:0.5 G4:1  E4:3   G4:1.5 A4:0.5 G4:1  E4:3   D5:2 D5:1  B4:3   C5:2 C5:1  G4:3
        A4:2 A4:1  C5:1.5 B4:0.5 A4:1  G4:1.5 A4:0.5 G4:1  E4:3   A4:2 A4:1  C5:1.5 B4:0.5 A4:1  G4:1.5 A4:0.5 G4:1  E4:3
        D5:2 D5:1  F5:1.5 D5:0.5 B4:1  C5:3  E5:3   C5:1.5 G4:0.5 E4:1  G4:1.5 F4:0.5 D4:1  C4:3  -:3`),
      akkoorden: 'C C C C G G C C F F C C F F C C G G C C C G C C'.split(' '),
    },
  };
  /* G1 (geluidskeuring 11-11): opvulling = zacht klokkenspel-antwoord (akkoordtonen hoger) in de lange slotnoot van
   * een zin. Gemeten gaten: maat 4 en 12 (E5 4 tellen, -35 dB), maat 8 (D5/G5 halve noten, -28 dB).
   * [noot, tel in de maat (0 = tel 1)]. */
  const OPVULLING = {
    jinglebells: {
      4: [['G5', 1.5], ['C6', 2], ['E6', 2.5], ['G6', 3], ['E6', 3.5]],
      8: [['B5', 1], ['D6', 1.5], ['B5', 3], ['D6', 3.5]],
      12: [['G5', 1.5], ['C6', 2], ['E6', 2.5], ['G6', 3], ['E6', 3.5]],
    },
  };
  function naamLied(lied) { return Object.keys(LIEDJES).find((k) => LIEDJES[k] === lied); }
  const AKKOORD = { C: ['C3', 'E4', 'G4'], F: ['F3', 'A4', 'C5'], G: ['G3', 'B4', 'D5'] };

  /* ---- Klanken ---- */
  /** Eén aangeslagen toon: som van (verhouding, sterkte) sinussen met snelle aanslag en exponentiële uitsterving. */
  /*
   * Vooruit inplannen (G1, 11-11): alles bij de tik op start aanmaken kostte 3172 klankbronnen / 126 ms op de pc
   * (op een oudere gsm 4-6x trager), langer dan de 0,1 s voorsprong vóór de eerste noot -> eerste noten te laat.
   * Daarom zet planLied() in een gewone AudioContext alleen OPDRACHTEN in een wachtrij; speel() maakt telkens de
   * klanken van de komende 3 s aan (elke 0,25 s). OfflineAudioContext (meting) = wachtrij uit, alles meteen.
   */
  let wachtrij = null;
  function uitstel(t, maak) { if (wachtrij) wachtrij.push([t, maak]); else maak(); }
  function toon(ctx, uit, f, t, sterkte, boventonen, uitsterven) {
    uitstel(t, () => toonNu(ctx, uit, f, t, sterkte, boventonen, uitsterven));
  }
  function toonNu(ctx, uit, f, t, sterkte, boventonen, uitsterven) {
    for (const [verhouding, deel, extraKort] of boventonen) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = f * verhouding;
      const einde = uitsterven * (extraKort || 1);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(sterkte * deel, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + einde);
      osc.connect(g).connect(uit);
      osc.start(t);
      osc.stop(t + einde + 0.05);
    }
  }
  // Speeldoos: tongetje = grondtoon + octaaf + een korte, hoge "tik" (onharmonisch, zoals een stalen kam).
  const SPEELDOOS = [[1, 1], [2, 0.32, 0.6], [3, 0.08, 0.4], [5.4, 0.06, 0.12]];
  // Klokkenspel/staafklok: onharmonische boventonen 2,76 en 5,40 (vrij-vrije staaf).
  const KLOKKENSPEL = [[1, 1], [2.76, 0.42, 0.5], [5.4, 0.16, 0.25], [8.93, 0.05, 0.12]];

  /** Sleebelletjes: korte uitbarsting gefilterde ruis rond 7-9 kHz. */
  function sleebelRuis(ctx, uit, ruis, t, sterkte) { uitstel(t, () => sleebelRuisNu(ctx, uit, ruis, t, sterkte)); }
  function sleebelRuisNu(ctx, uit, ruis, t, sterkte) {
    const bron = ctx.createBufferSource();
    bron.buffer = ruis;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 7000 + Math.random() * 2000;
    filter.Q.value = 6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(sterkte, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    bron.connect(filter).connect(g).connect(uit);
    bron.start(t, Math.random() * 0.5, 0.2);
  }

  /**
   * Sleebelletjes "metaal" (geluidskeuring 11-11: de ruis-belletjes hierboven waren meetbaar bijna onhoorbaar,
   * 0 % energie boven 5 kHz). Echte sleebel = bolletje met een balletje erin; één schud = enkele belletjes kort
   * na elkaar. Per belletje 3 onharmonische tonen (2,6-4,2 kHz) die snel uitsterven + een kort breed "rinkeltje".
   * Sterkte-schaal BEL_METAAL afgesteld op meting (zie EXPERTKEURING_geluid.md).
   */
  const BELLETJE = [[1, 0.5, 0.16], [1.58, 0.3, 0.11], [2.41, 0.18, 0.07]];
  const BEL_METAAL = 1.4;     // gemeten 11-11: scène 2 = 6 %, zwelling/vlucht = 17 %, intro = 53 % energie boven 2 kHz
  function sleebelMetaal(ctx, uit, ruis, t, sterkte) { uitstel(t, () => sleebelMetaalNu(ctx, uit, ruis, t, sterkte)); }
  function sleebelMetaalNu(ctx, uit, ruis, t, sterkte) {
    const s0 = sterkte * BEL_METAAL;
    for (let h = 0; h < 3; h++) {
      const th = t + h * (0.006 + Math.random() * 0.012);
      const basis = 2600 + Math.random() * 1600;
      for (const [verhouding, deel, duur] of BELLETJE) {
        const osc = ctx.createOscillator(), g = ctx.createGain();
        osc.frequency.value = basis * verhouding;
        g.gain.setValueAtTime(0, th);
        g.gain.linearRampToValueAtTime(s0 * deel * (h ? 0.7 : 1), th + 0.002);
        g.gain.exponentialRampToValueAtTime(0.0001, th + duur);
        osc.connect(g).connect(uit);
        osc.start(th);
        osc.stop(th + duur + 0.02);
      }
    }
    const bron = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), g = ctx.createGain();
    bron.buffer = ruis;
    filter.type = 'bandpass'; filter.frequency.value = 6500; filter.Q.value = 1.2;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(s0 * 0.6, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    bron.connect(filter).connect(g).connect(uit);
    bron.start(t, Math.random() * 0.5, 0.08);
  }

  /** Eenvoudige galm (zaal): impulsrespons = uitstervende ruis, zelf berekend. */
  function galm(ctx, seconden) {
    const n = Math.round(ctx.sampleRate * seconden);
    const buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let k = 0; k < 2; k++) {
      const d = buf.getChannelData(k);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3);
    }
    const c = ctx.createConvolver();
    c.buffer = buf;
    return c;
  }

  function ruisBuffer(ctx) {
    const n = ctx.sampleRate;
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  function duurLied(naam) {
    const lied = LIEDJES[naam];
    return lied.melodie.reduce((s, n) => s + n.tellen, 0) * 60 / lied.tempo;
  }

  /**
   * Plant één keer het hele lied in vanaf tijdstip t0. Geeft de eindtijd terug.
   * opties.intro = aantal maten alleen sleebelletjes vóór de melodie (filmpje: 2).
   * opties.zwelling = {van, tot, factor}: sleebelletjes zwellen aan vanaf melodiemaat 'van' tot 'tot' naar 'factor'
   *   x de gewone sterkte en blijven daar tot het einde (filmpje: slee nadert, maat 7-9).
   */
  function planLied(ctx, uit, lied, klank, t0, ruis, opties) {
    const tel = 60 / lied.tempo;
    const intro = (opties && opties.intro) || 0;
    const zwelling = opties && opties.zwelling;
    const boventonen = klank === 'belletjes' ? KLOKKENSPEL : SPEELDOOS;
    const uitsterven = klank === 'belletjes' ? 2.2 : 1.6;
    const sleebel = opties && opties.belklank === 'metaal' ? sleebelMetaal : sleebelRuis;   // geluidskeuring G1
    const begin = t0;
    // Intro (10-11, gemeten: alleen sleebelletjes op gewone sterkte = bijna stil, RMS 0,003): sleebelletjes 2,5x
    // in zestienden + per maat een zacht fonkelend akkoordje (G5-C6-E6-G6) op het klokkenspel.
    for (let x = begin; x < begin + intro * lied.maat * tel - 0.01; x += tel / 4) {
      const opTel = Math.abs(((x - begin) / tel) % 1) < 0.01;
      sleebel(ctx, uit, ruis, x, opTel ? 0.25 : 0.12);
    }
    for (let m = 0; m < intro; m++) {
      ['G5', 'C6', 'E6', 'G6'].forEach((n, i) =>
        toon(ctx, uit, frequentie(n), begin + m * lied.maat * tel + i * tel / 2, 0.09, KLOKKENSPEL, 2.0));
    }
    if (opties && opties.opvullen) {                            // G1: tweede helft intromaat dalend antwoord (was -40 dB)
      for (let m = 0; m < intro; m++) {
        ['G6', 'E6', 'C6', 'G5'].forEach((n, i) =>
          toon(ctx, uit, frequentie(n), begin + m * lied.maat * tel + (2 + i / 2) * tel, 0.06, KLOKKENSPEL, 1.6));
      }
    }
    t0 = begin + intro * lied.maat * tel;
    let t = t0;
    for (const { noot, tellen } of lied.melodie) {             // melodie
      if (noot !== '-') toon(ctx, uit, frequentie(noot), t, 0.22, boventonen, uitsterven);
      t += tellen * tel;
    }
    lied.akkoorden.forEach((naam, maat) => {                    // begeleiding: bas op tel 1, zacht akkoord op tel 2 (en 4)
      const [bas, terts, kwint] = AKKOORD[naam];
      const begin = t0 + maat * lied.maat * tel;
      toon(ctx, uit, frequentie(bas), begin, 0.16, SPEELDOOS, 2.0);
      for (let k = 1; k < lied.maat; k += 2) {
        toon(ctx, uit, frequentie(terts), begin + k * tel, 0.05, SPEELDOOS, 1.0);
        toon(ctx, uit, frequentie(kwint), begin + k * tel, 0.04, SPEELDOOS, 1.0);
      }
    });
    if (opties && opties.opvullen) {                            // G1: lange slotnoten van een zin opvullen (muziek viel 1 s weg)
      for (const [maat, noten] of Object.entries(OPVULLING[naamLied(lied)] || {})) {
        const mb = t0 + (Number(maat) - 1) * lied.maat * tel;
        noten.forEach(([noot, opTel]) => toon(ctx, uit, frequentie(noot), mb + opTel * tel, 0.07, KLOKKENSPEL, 1.4));
      }
    }
    if (klank === 'belletjes') {                                // sleebelletjes op elke achtste noot, accent op de tel
      const maatDuur = lied.maat * tel;
      // Zwelling (10-11, gemeten: alleen sterker op achtsten was onhoorbaar, hoge band +9 %): vanaf zwelling.van
      // ook zestienden ertussen (de slee "schudt" dichterbij) én sterker, oplopend tot zwelling.tot.
      for (let x = t0; x < t - 0.01; x += tel / 4) {
        const inTel = ((x - t0) / tel) % 1;
        const opTel = Math.abs(inTel) < 0.01 || Math.abs(inTel - 1) < 0.01;
        const opAchtste = opTel || Math.abs(inTel - 0.5) < 0.01;
        let deel = 0, wegF = 1;
        if (zwelling) {                                         // melodiemaat (1-gebaseerd, met breuk) van dit tijdstip
          const maat = 1 + (x - t0) / maatDuur;
          deel = Math.min(1, Math.max(0, (maat - zwelling.van) / (zwelling.tot - zwelling.van)));
          if (zwelling.weg) {                                   // G1: belletjes sterven weg met de slee ([van, tot, eindfactor])
            const [wv, wt, eind] = zwelling.weg;
            wegF = 1 + (eind - 1) * Math.min(1, Math.max(0, (maat - wv) / (wt - wv)));
          }
        }
        if (!opAchtste && deel === 0) continue;                // zonder zwelling: alleen achtsten (zoals gekozen)
        const factor = (1 + (zwelling ? zwelling.factor - 1 : 0) * deel) * wegF;
        const basis = opTel ? 0.10 : opAchtste ? 0.05 : 0.04 * deel;
        sleebel(ctx, uit, ruis, x, basis * factor);
      }
    }
    if (opties && opties.slot) {                                // slotakkoord dat lang uitklinkt (uitsterven 8 s = ± 10 dB per seconde) op de laatste noot
      const laatste = t - lied.melodie[lied.melodie.length - 1].tellen * tel;
      ['C3', 'C4', 'E4', 'G4', 'C5', 'E5', 'G5'].forEach((n, i) =>
        toon(ctx, uit, frequentie(n), laatste + i * 0.04, i === 0 ? 0.14 : 0.07, i === 0 ? SPEELDOOS : KLOKKENSPEL, 8));
      for (let k = 0; k < 10; k++) sleebel(ctx, uit, ruis, laatste + k * tel / 4, 0.12 * (1 - k / 10));
    }
    return t;
  }

  /* ---- Geluidjes voor het filmpje (zelf berekend, heel zacht onder de muziek) ---- */
  /** Zacht laserzoemen: lage zoemtoon + gefilterde ruis, in- en uitfaden. */
  function laserZoem(ctx, uit, t, duur) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.035, t + 0.25);
    g.gain.setValueAtTime(0.035, t + duur - 0.4);
    g.gain.linearRampToValueAtTime(0, t + duur);
    g.connect(uit);
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 118;
    const laag = ctx.createBiquadFilter();
    laag.type = 'lowpass';
    laag.frequency.value = 600;
    osc.connect(laag).connect(g);
    osc.start(t);
    osc.stop(t + duur + 0.05);
    const ruis = ctx.createBufferSource();
    ruis.buffer = ruisBuffer(ctx);
    ruis.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 3200;
    band.Q.value = 1.5;
    const rg = ctx.createGain();
    rg.gain.value = 0.35;
    ruis.connect(band).connect(rg).connect(g);
    ruis.start(t);
    ruis.stop(t + duur + 0.05);
  }

  /** Fonkelklank: willekeurige hoge belletjes (sterrenstof), dichtheid ± 8 per seconde. */
  function fonkel(ctx, uit, t, duur, sterkte = 1) {         // sterkte: G1 (belletjes zitten nu in dezelfde toonhoogte)
    for (let x = t; x < t + duur; x += 0.06 + Math.random() * 0.12) {
      const f = 2000 + Math.random() * 2600;
      toon(ctx, uit, f, x, (0.025 + Math.random() * 0.02) * sterkte, KLOKKENSPEL, 0.6);
    }
  }

  /** Tinkel: drie snelle hoge klokjes (C7-E7-G7) bij het verschijnen van de naam. */
  function tinkel(ctx, uit, t, sterkte = 1) {
    ['C7', 'E7', 'G7'].forEach((n, i) => toon(ctx, uit, frequentie(n), t + i * 0.09, 0.07 * sterkte, KLOKKENSPEL, 1.4));
  }

  /**
   * Speelt een lied. opties.herhaal = true: blijft herhalen tot stop() (plant telkens één ronde vooruit).
   * Geeft een stop-functie terug (zachte fade-out van 1,2 s).
   */
  function speel(ctx, naam, klank, opties) {
    const lied = LIEDJES[naam];
    const herhaal = opties && opties.herhaal;
    const hoofd = ctx.createGain();
    hoofd.gain.value = (opties && opties.volume) || 0.8;
    const compressor = ctx.createDynamicsCompressor();         // voorkomt oversturing op gsm-luidsprekers
    const zaal = galm(ctx, 2.2);
    const nat = ctx.createGain();
    nat.gain.value = 0.22;
    const mix = ctx.createGain();
    mix.connect(compressor);
    mix.connect(zaal).connect(nat).connect(compressor);
    // G1: begrenzer na het volume, zodat een hoger volume (filmpje) nooit oversturt
    const begrenzer = ctx.createDynamicsCompressor();
    begrenzer.threshold.value = -2; begrenzer.knee.value = 0; begrenzer.ratio.value = 20;
    begrenzer.attack.value = 0.001; begrenzer.release.value = 0.1;
    compressor.connect(hoofd).connect(begrenzer).connect(ctx.destination);
    const ruis = ruisBuffer(ctx);
    iPhoneStilteknop();

    const start = ctx.currentTime + 0.1;
    const offline = typeof OfflineAudioContext !== 'undefined' && ctx instanceof OfflineAudioContext;
    wachtrij = offline ? null : [];
    let volgende = planLied(ctx, mix, lied, klank, start, ruis, opties);
    const rij = (wachtrij || []).sort((a, b) => a[0] - b[0]);
    wachtrij = null;
    let positie = 0, pompWekker = null;
    const pomp = () => {                                        // klanken van de komende 3 s aanmaken
      const grens = ctx.currentTime + 3;
      while (positie < rij.length && rij[positie][0] < grens) rij[positie++][1]();
      if (positie < rij.length && typeof setTimeout === 'function') pompWekker = setTimeout(pomp, 250);
    };
    pomp();
    let wekker = null;
    if (herhaal && typeof setTimeout === 'function') {
      const verder = Object.assign({}, opties, { intro: 0 });  // intro alleen de eerste keer
      const ronde = () => {
        volgende = planLied(ctx, mix, lied, klank, volgende + 60 / lied.tempo * lied.maat, ruis, verder);
        wekker = setTimeout(ronde, (volgende - ctx.currentTime - 3) * 1000);
      };
      wekker = setTimeout(ronde, (volgende - ctx.currentTime - 3) * 1000);
    }
    function stop() {
      if (wekker) clearTimeout(wekker);
      if (pompWekker) clearTimeout(pompWekker);
      positie = rij.length;
      const nu = ctx.currentTime;
      hoofd.gain.cancelScheduledValues(nu);
      hoofd.gain.setValueAtTime(hoofd.gain.value, nu);
      hoofd.gain.linearRampToValueAtTime(0, nu + 1.2);
      setTimeout(() => { try { hoofd.disconnect(); } catch (e) { /* al los */ } }, 1500);
    }
    // Voor het filmpje: starttijd (audioklok, voor beeld-synchronisatie) en geluidjes op dezelfde mix
    stop.start = start;
    stop.maatDuur = lied.maat * 60 / lied.tempo;
    stop.geluid = {
      laser: (t, duur) => laserZoem(ctx, mix, t, duur),
      fonkel: (t, duur, sterkte) => fonkel(ctx, mix, t, duur, sterkte),
      tinkel: (t, sterkte) => tinkel(ctx, mix, t, sterkte),
    };
    return stop;
  }

  /** iPhone: Web Audio volgt standaard de stilteknop (WebKit). 'playback' = gedraagt zich als muziek/video
   *  (iOS 17+, alleen Safari kent dit; elders niets doen). Werking NOT TESTED op een echte iPhone. */
  function iPhoneStilteknop() {
    try {
      if (typeof navigator !== 'undefined' && 'audioSession' in navigator) navigator.audioSession.type = 'playback';
    } catch (e) { /* oudere toestellen: geen effect */ }
  }

  globaal.KerstMuziek = {
    speel,
    duur: (naam, intro) => duurLied(naam) + (intro || 0) * LIEDJES[naam].maat * 60 / LIEDJES[naam].tempo,
    liedjes: Object.keys(LIEDJES).map((k) => ({ id: k, titel: LIEDJES[k].titel })),
  };
})(window);
