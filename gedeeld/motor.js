/* K24 bewegingsmotor (11-11-2026, stap C van ONDERZOEK_echte_beweging.md).
 *
 * Tekent de bewegende kaarttekening op een <canvas>: dieptelagen (stap B) + losse figuren (stap A) met draaipunten,
 * ouder-kind-ketting (oor draait mee met de kop), "ademen" en een binnen-camera met diepte. Geen externe library:
 * de tijd komt van buiten (de klok van de muziek in de animatic), zodat beeld en geluid nooit uit elkaar lopen.
 *
 * Assenstelsel: dat van animatie/hert/tekening.png (1200 x 795 px). Het canvas IS het tekeningvak, dus alles wordt
 * vanzelf afgesneden binnen het tekeningvak (camera-regel 3).
 *
 * Camera-regels (expertkeuring stap B, VERPLICHT, hier afgedwongen in camera()):
 *   1. nooit verder uitzoomen dan rust: zoom >= 1 (de tekening houdt op aan de kaartrand)
 *   2. opzij schuiven alleen met genoeg inzoom: |dx| <= (zoom - 1) * 600
 *   3. afsnijden binnen het tekeningvak (= het canvas)
 *   4. diepte-effect klein: zoom <= 1,08 en |dx| <= 8 px (de hele kaart in- of uitzoomen gebeurt BUITEN de motor)
 *
 * Gebruik:
 *   const kaart = await KerstMotor.maak({ canvas, figuren: 'figuren/', lagen: 'lagen/' });
 *   kaart.teken({ camera: {zoom, dx}, hoek: {hert_kop: 3}, adem: {hert_lijf: 0.005}, schuif: {hert_kop: [0, -2]} });
 *   const kop = KerstMotor.spoor([[0, 0], [1.5, 3, 'zacht'], [3, 0, 'zacht']]);   kop(t) -> waarde op tijd t
 * Hoeken in graden, positief = tegen de klok in (zelfde afspraak als de Python-keuringen van stap A).
 */
(function (globaal) {
  'use strict';

  const MAAT = [1200, 795];
  const CAMERA = { midden: [600, 560], maxZoom: 1.08, maxDx: 8 };

  /* ---- Zachte bewegingen (geen lineaire bewegingen in een professionele animatie) ---- */
  const ease = {
    lineair: (t) => t,
    zacht: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),       // zacht in en uit
    uit: (t) => 1 - Math.pow(1 - t, 3),                                          // snel weg, zacht aankomen
    in: (t) => t * t * t,
    naveer: (t) => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },   // schiet licht door
  };

  /** Spoor met sleutelmomenten [[tijd, waarde, overgang?], ...] (gesorteerd) -> functie(t) = waarde. */
  function spoor(punten) {
    return function (t) {
      if (t <= punten[0][0]) return punten[0][1];
      for (let i = 1; i < punten.length; i++) {
        const [t1, v1, soort] = punten[i];
        const [t0, v0] = punten[i - 1];
        if (t <= t1) {
          if (t1 <= t0) return v1;                             // twee sleutelmomenten op hetzelfde tijdstip = sprong
          return v0 + (v1 - v0) * (ease[soort || 'zacht'])((t - t0) / (t1 - t0));
        }
      }
      return punten[punten.length - 1][1];
    };
  }

  /** Camera-regels afdwingen (zie kop). Geeft de toegelaten camera terug. */
  function camera(c) {
    c = c || {};
    const getal = (v, standaard) => (Number.isFinite(v) ? v : standaard);   // ongeldig (NaN, tekst) -> rust
    const zoom = Math.min(CAMERA.maxZoom, Math.max(1, getal(c.zoom, 1)));
    const grens = Math.min(CAMERA.maxDx, (zoom - 1) * 600);
    const dx = Math.max(-grens, Math.min(grens, getal(c.dx, 0)));
    return { zoom, dx };
  }

  /** Houtkleur van de kaart op hoogte y (tekening-assenstelsel), zelfde formule als houtkleur() in de Python-scripts. */
  function houtkleur(y) {
    const licht = [236, 217, 184], donker = [220, 194, 154];
    const s = 300 / 1200, kaartH = 16 + 795 * s + 112;
    const t = (16 + y * s) / kaartH;
    return licht.map((l, i) => l + (donker[i] - l) * t);
  }

  function laadBeeld(pad) {
    return new Promise((klaar, fout) => {
      const img = new Image();
      img.onload = () => klaar(img);
      img.onerror = () => fout(new Error('Kan beeld niet laden: ' + pad));
      img.src = pad;
    });
  }
  async function laadJson(pad) {
    const r = await fetch(pad);
    if (!r.ok) throw new Error('Kan niet laden: ' + pad);
    return r.json();
  }

  /** Transform van een dieptelaag (factor f: 0 = staat stil, 1 = beweegt zoals 'dichtbij' en de dieren). */
  function laagTransform(ctx, cam, f) {
    const [mx, my] = CAMERA.midden;
    const s = 1 + (cam.zoom - 1) * f;
    ctx.translate(mx + cam.dx * f, my);
    ctx.scale(s, s);
    ctx.translate(-mx, -my);
  }

  /** Lokale beweging van één deel: verschuiven, ademen (verticaal rond de voeten), draaien rond het draaipunt. */
  function deelTransform(ctx, naam, d, staat) {
    const schuif = (staat.schuif || {})[naam];
    if (schuif) ctx.translate(schuif[0], schuif[1]);
    const adem = (staat.adem || {})[naam];
    if (adem) {                                               // lijf zet uit vanaf de hoeven (voeten blijven staan)
      const voet = d.y + d.h;
      ctx.translate(0, voet); ctx.scale(1, 1 + adem); ctx.translate(0, -voet);
    }
    const hoek = (staat.hoek || {})[naam];
    if (hoek && d.draaipunt) {
      const [px, py] = d.draaipunt;
      ctx.translate(px, py); ctx.rotate(-hoek * Math.PI / 180); ctx.translate(-px, -py);
    }
  }

  /** Keten van ouders, van de wortel naar het deel zelf (kop -> [lijf, kop]; oor -> [lijf, kop, oor]). */
  function keten(delen, naam) {
    const uit = [];
    for (let n = naam; n; n = delen[n].ouder) uit.unshift(n);
    return uit;
  }

  async function maak(opties) {
    const canvas = opties.canvas;
    // opties.versie: wordt aan elk bestand gehangen (?v=...), zodat de browser na een update van figuren/lagen nooit
    // een oude bewaarde JSON combineert met nieuwe beelden (11-11: gaf verkeerd geplaatste oren in de zelftest).
    const v = opties.versie ? '?v=' + encodeURIComponent(opties.versie) : '';
    const laadBeeldV = (pad) => laadBeeld(pad + v);
    const [fig, lag] = await Promise.all([laadJson(opties.figuren + 'figuren.json' + v), laadJson(opties.lagen + 'lagen.json' + v)]);
    const delen = fig.kaart.delen;
    const volgorde = ['hert_lijf', 'hert_kop', 'hert_oor_l', 'hert_oor_r', 'jong_lijf', 'jong_kop'];
    const lagenNamen = ['lucht', 'ver', 'dichtbij'];
    const beeld = {};
    await Promise.all([
      ...lagenNamen.map(async (n) => { beeld[n] = await laadBeeldV(opties.lagen + n + '.png'); }),
      ...volgorde.map(async (n) => { beeld[n] = await laadBeeldV(opties.figuren + n + '.png'); }),
    ]);

    /** Tekent één beeld van de kaarttekening. staat: {camera, hoek, adem, schuif, ondergrond(bool, voor tests)}. */
    function teken(staat) {
      staat = staat || {};
      const ctx = canvas.getContext('2d');
      const cam = camera(staat.camera);
      ctx.setTransform(canvas.width / MAAT[0], 0, 0, canvas.height / MAAT[1], 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.clearRect(0, 0, MAAT[0], MAAT[1]);
      if (staat.ondergrond) {                                  // alleen voor tests: kaarthout zoals in het filmpje
        for (let y = 0; y < MAAT[1]; y++) {
          const [r, g, b] = houtkleur(y);
          ctx.fillStyle = `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
          ctx.fillRect(0, y, MAAT[0], 1);
        }
      }
      if (!staat.zonderLagen) {                                // zonderLagen: alleen voor tests (gaten in de figuren meten)
        for (const n of lagenNamen) {
          ctx.save(); laagTransform(ctx, cam, lag.diepte[n]); ctx.drawImage(beeld[n], 0, 0); ctx.restore();
        }
      }
      for (const n of volgorde) {                              // dieren bewegen mee met 'dichtbij' (ze staan op de grond)
        ctx.save();
        laagTransform(ctx, cam, lag.diepte[lag.dieren_horen_bij]);
        for (const k of keten(delen, n)) deelTransform(ctx, k, delen[k], staat);
        ctx.drawImage(beeld[n], delen[n].x, delen[n].y);
        ctx.restore();
      }
      return cam;
    }
    return { teken, canvas, delen, lagen: lag, maat: MAAT };
  }

  /* ===================== Slee (stap D2, 11-11-2026) =====================
   * Kerstman + slee + 3 rendieren (stap A: figuren/rendier_1..3.png, slee.png) in hun eigen assenstelsel
   * (uitsnede van K23 slee4_v2, 952 x 369). De teugels worden NIET als beeld getekend maar opnieuw als gebogen
   * lijnen tussen de ankerpunten (figuren.json 'teugelankers'), zodat ze meebuigen als de rendieren deinen.
   * Gespiegeld (keuze de maker: vliegt links -> rechts). Donker silhouet met een zachte maanlichtrand (leesbaar ook
   * naast de maan; keuring stap A punt 2).
   */
  // keuring D2: bijna zwart silhouet (zelfde als SLEE_KLEUR in maak_k24_figuren.py) + sterkere maanlichtrand: naast de
  // maan was het contrast met de nachtlucht maar 1,3-1,5.
  const SLEE = { breed: 952, hoog: 369, kerstman: [809, 144], teugelDik: 5, kleur: '#05080e', rand: 'rgba(250,240,205,0.75)' };

  /** Teugels = paren ankers: achterkant deel i <-> voorkant deel i+1 (bovenste met bovenste, onderste met onderste). */
  function teugelParen(delen, ankers) {
    const volgorde = ['rendier_1', 'rendier_2', 'rendier_3', 'slee'];
    const paren = [];
    for (let i = 0; i < volgorde.length - 1; i++) {
      const a = volgorde[i], b = volgorde[i + 1];
      const achter = ankers.filter((p) => p.deel === a && p.xy[0] > delen[a].midden[0]).sort((p, q) => p.xy[1] - q.xy[1]);
      const voor = ankers.filter((p) => p.deel === b && p.xy[0] < delen[b].midden[0]).sort((p, q) => p.xy[1] - q.xy[1]);
      if (!achter.length || !voor.length) continue;
      paren.push([achter[0], voor[0]]);                                        // bovenste teugel
      if (achter.length > 1 && voor.length > 1) paren.push([achter[achter.length - 1], voor[voor.length - 1]]);   // onderste
    }
    return paren;
  }

  async function maakSlee(opties) {
    const v = opties.versie ? '?v=' + encodeURIComponent(opties.versie) : '';
    const fig = await laadJson(opties.figuren + 'figuren.json' + v);
    const delen = fig.slee.delen;
    const namen = ['rendier_1', 'rendier_2', 'rendier_3', 'slee'];
    const beeld = {};
    await Promise.all(namen.map(async (n) => { beeld[n] = await laadBeeld(opties.figuren + n + '.png' + v); }));
    const paren = teugelParen(delen, fig.slee.teugelankers);

    /** Tekent de slee op ctx (schermpixels). staat: {x, y = plaats van de KERSTMAN op het scherm, schaal (scherm px per
     *  bron-px), hoek (graden, hele span, + = tegen de klok), deinen: [d1, d2, d3] bron-px per rendier, wiebel (graden slee)}. */
    function teken(ctx, staat) {
      const s = staat.schaal, verschuiving = { rendier_1: 0, rendier_2: 0, rendier_3: 0, slee: 0 };
      (staat.deinen || []).forEach((d, i) => { verschuiving[namen[i]] = d; });
      const anker = (p) => [p.xy[0], p.xy[1] + verschuiving[p.deel]];
      ctx.save();
      ctx.translate(staat.x, staat.y);
      ctx.rotate(-(staat.hoek || 0) * Math.PI / 180);
      ctx.scale(-s, s);                                                        // gespiegeld: vliegt naar rechts
      ctx.translate(-SLEE.kerstman[0], -SLEE.kerstman[1]);
      ctx.shadowColor = SLEE.rand;
      ctx.shadowBlur = Math.max(1.5, 4 * s * (staat.pixelVerhouding || 1));
      // teugels: kwadratische boog met een lichte doorhang die groter wordt naarmate de teugel korter is (los).
      // D2-test: op gsm-grootte is een teugel ± 1,4 px dik; met de volle maanlichtgloed oogde hij LICHT. Daarom een
      // veel zwakkere gloed op de teugels (ze blijven donkere lijnen zoals in de tekening); de dieren houden de rand.
      ctx.save();
      ctx.shadowColor = 'rgba(250,240,205,0.18)';
      ctx.strokeStyle = SLEE.kleur; ctx.lineWidth = SLEE.teugelDik; ctx.lineCap = 'round';
      for (const [p, q] of paren) {
        const [x1, y1] = anker(p), [x2, y2] = anker(q);
        const lengte = Math.hypot(x2 - x1, y2 - y1), rust = Math.hypot(q.xy[0] - p.xy[0], q.xy[1] - p.xy[1]);
        const doorhang = 6 + Math.max(0, rust - lengte) * 1.5;               // korter dan in rust -> hangt meer door
        ctx.beginPath(); ctx.moveTo(x1, y1);
        ctx.quadraticCurveTo((x1 + x2) / 2, (y1 + y2) / 2 + doorhang, x2, y2); ctx.stroke();
      }
      ctx.restore();
      for (const n of namen) {
        const d = delen[n];
        ctx.save();
        ctx.translate(0, verschuiving[n]);
        if (n === 'slee' && staat.wiebel) {
          const [mx, my] = d.midden; ctx.translate(mx, my); ctx.rotate(-staat.wiebel * Math.PI / 180); ctx.translate(-mx, -my);
        }
        ctx.drawImage(beeld[n], d.x, d.y);
        ctx.restore();
      }
      ctx.restore();
    }
    /** Plaats op het scherm van een punt in het slee-assenstelsel (bv. de achterkant van de slee voor het sterrenspoor). */
    function punt(staat, bx, by) {
      const s = staat.schaal, h = -(staat.hoek || 0) * Math.PI / 180;
      const lx = -(bx - SLEE.kerstman[0]) * s, ly = (by - SLEE.kerstman[1]) * s;   // gespiegeld
      return [staat.x + lx * Math.cos(h) - ly * Math.sin(h), staat.y + lx * Math.sin(h) + ly * Math.cos(h)];
    }
    return { teken, punt, delen, paren, SLEE };
  }

  globaal.KerstMotor = { maak, maakSlee, spoor, ease, camera, houtkleur, CAMERA, MAAT };
})(window);
