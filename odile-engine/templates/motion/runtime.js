/* Odile Motion — moteur de lecture.
 *
 * Même principe que les scènes « HyperFrames » : chaque séquence du film est une
 * scène HTML construite sur une timeline GSAP en pause, et une seule horloge —
 * `__motion.seek(t)` — les pilote toutes. Rien n'est lu en temps réel : l'aperçu
 * appelle seek() à chaque image d'écran, l'export à chaque image du MP4, et deux
 * appels au même instant donnent exactement la même image.
 *
 * Le film arrive dans `window.__FILM__` : { largeur, hauteur, fps, marque, sections }.
 * `?section=<id>` ne construit qu'une séquence (vignettes du dashboard).
 */
(function () {
  'use strict';
  var FILM = window.__FILM__;
  var W = FILM.largeur, H = FILM.hauteur;
  var U = Math.min(W, H) / 100; // 1rem en pixels
  var root = document.documentElement;
  root.style.setProperty('--w', W + 'px');
  root.style.setProperty('--h', H + 'px');
  root.style.fontSize = U + 'px';
  var ORIENT = H > W * 1.15 ? 'portrait' : W > H * 1.15 ? 'paysage' : 'carre';
  document.body.classList.add(ORIENT);
  var PAYSAGE = ORIENT === 'paysage', PORTRAIT = ORIENT === 'portrait';
  var LOGO = FILM.marque && FILM.marque.logo;

  // Hasard reproductible : même graine, mêmes étoiles, à chaque rendu.
  var graine = 11;
  function hasard() { graine = (graine * 16807) % 2147483647; return (graine - 1) / 2147483646; }

  function el(parent, cls, html) {
    var n = document.createElement('div');
    if (cls) n.className = cls;
    if (html !== undefined) n.innerHTML = html;
    parent.appendChild(n);
    return n;
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }
  function img(parent, cls) {
    if (!LOGO) return el(parent, cls, '<b style="font-size:6rem;font-weight:800;letter-spacing:-.04em">' + esc(FILM.marque.nom) + '</b>');
    var i = document.createElement('img');
    i.src = LOGO; i.alt = FILM.marque.nom;
    if (cls) i.className = cls;
    parent.appendChild(i);
    return i;
  }

  // ---- Icônes (tracé maison, 24×24) --------------------------------------------
  var ICONES = {
    mail: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3.8 7.2l8.2 5.8 8.2-5.8"/>',
    ia: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
    base: '<ellipse cx="12" cy="6" rx="7.5" ry="3"/><path d="M4.5 6v12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6"/><path d="M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3"/>',
    envoi: '<path d="M21 3L10.2 13.8"/><path d="M21 3l-6.8 18-4-7.2L3 9.8z"/>',
    coche: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    loupe: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/>',
    boucle: '<path d="M19.5 11A7.5 7.5 0 0 0 6.2 6.6L4.5 8.5"/><path d="M4.5 4v4.5H9"/><path d="M4.5 13a7.5 7.5 0 0 0 13.3 4.4l1.7-1.9"/><path d="M19.5 20v-4.5H15"/>',
    agent: '<rect x="4.5" y="8" width="15" height="11" rx="3.2"/><path d="M12 8V4.8"/><circle cx="12" cy="3.8" r="1"/><circle cx="9.4" cy="13.4" r="1.1"/><circle cx="14.6" cy="13.4" r="1.1"/><path d="M2.5 12.5v2.5M21.5 12.5v2.5"/>',
    calendrier: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    document: '<path d="M6.5 3h7.5l4.5 4.5V21h-12z"/><path d="M14 3v4.5h4.5M9 13h6M9 17h6"/>',
  };
  function icone(nom) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + (ICONES[nom] || ICONES.ia) + '</svg>';
  }
  var CURSEUR = '<svg viewBox="0 0 24 24"><path d="M5 2.5l13.5 12.2-6.3.5 3.8 7.2-2.6 1.3-3.7-7.3L5 20.8z" fill="#fff" stroke="#0a0c10" stroke-width="1.3" stroke-linejoin="round"/></svg>';

  // ---- Texte : « *mot* » passe en bleu glace, le reste en chrome --------------------
  function lettres(parent, texte, cls) {
    // Une ligne de titre géant, découpée en lettres (entrées lettre par lettre).
    var ligne = el(parent, 'geant ' + (cls || ''));
    var morceaux = String(texte).split(/(\*[^*]+\*)/);
    morceaux.forEach(function (m) {
      if (!m) return;
      var accent = /^\*.*\*$/.test(m);
      var brut = accent ? m.slice(1, -1) : m;
      var bloc = el(ligne, accent ? 'glace' : 'chrome');
      bloc.style.display = 'inline-block';
      Array.from(brut).forEach(function (c) {
        var s = document.createElement('span');
        s.className = 'mot';
        s.textContent = c === ' ' ? ' ' : c;
        if (c === ' ') s.style.width = '.26em';
        bloc.appendChild(s);
      });
    });
    return ligne;
  }
  function motsTexte(parent, texte, cls) {
    // Ligne découpée en mots (entrées mot par mot).
    var ligne = el(parent, 'geant ' + (cls || ''));
    String(texte).split(' ').forEach(function (m) {
      if (!m) return;
      var accent = /^\*.*\*$/.test(m) || /^\*/.test(m) || /\*[.,!?]*$/.test(m);
      var brut = m.replace(/\*/g, '');
      var s = el(ligne, 'mot ' + (accent ? 'glace' : 'chrome'));
      s.textContent = brut;
    });
    return ligne;
  }
  // Taille qui fait tenir `node` dans `largeur` px (sans dépasser `maxRem`).
  function ajuster(node, largeur, maxRem) {
    node.style.fontSize = maxRem + 'rem';
    var w = node.scrollWidth;
    if (w > largeur) node.style.fontSize = (maxRem * largeur / w).toFixed(2) + 'rem';
    return node;
  }
  function largeurUtile(part) { return (W - (PAYSAGE ? 20 : PORTRAIT ? 12 : 14) * U) * (part || 1); }

  // ---- Décors ----------------------------------------------------------------------------
  function decorMur(seq, tl, span, opts) {
    var f = el(seq, 'fond');
    var mur = el(f, 'mur');
    var pas = 19 * U;
    // Repères « + » aux croisements, placés comme sur une planche de mise en page
    var n = opts && opts.reperes === false ? 0 : 4;
    var reperes = [];
    for (var i = 0; i < n; i++) {
      var r = el(f, 'repere');
      var col = [2, 5, 2, 5][i], lig = [1, 1, 3, 3][i];
      r.style.left = (W / 2 + (col - 3.5) * pas) + 'px';
      r.style.top = (H / 2 + (lig - 2) * pas) + 'px';
      reperes.push(r);
    }
    tl.fromTo(mur, { scale: 1.06 }, { scale: 1, duration: span, ease: 'none' }, 0);
    if (reperes.length) tl.from(reperes, { opacity: 0, scale: .4, duration: .5, stagger: .08, ease: 'power2.out' }, .05);
    el(f, 'vignette');
    return f;
  }
  function decorSol(seq, tl, span) {
    var f = el(seq, 'fond');
    el(f, 'brume');
    var cadre = el(f, 'sol-cadre');
    var sol = el(cadre, 'sol');
    var pas = 16 * U;
    // Le quadrillage avance vers la caméra : on glisse le motif, pas le plan.
    tl.fromTo(sol, { backgroundPosition: '0px 0px' }, { backgroundPosition: '0px ' + (pas * span * .9) + 'px', duration: span, ease: 'none' }, 0);
    el(f, 'vignette');
    return f;
  }
  function decorProjecteur(seq, tl, span, depart) {
    var f = el(seq, 'fond');
    var p = el(f, 'projecteur');
    p.style.left = (W * (depart ? depart[0] : .8)) + 'px';
    p.style.top = (H * (depart ? depart[1] : 1.05)) + 'px';
    tl.fromTo(p, { opacity: 0, scale: .55 }, { opacity: 1, scale: 1, duration: Math.min(2.2, span * .7), ease: 'power2.out' }, 0);
    el(f, 'vignette');
    return p;
  }

  // ---- Plans -------------------------------------------------------------------------------
  var PLANS = {};

  /* Accroche : des mots géants qui se remplacent à la même place, lettre par lettre. */
  PLANS.accroche = function (seq, p, tl, span) {
    decorMur(seq, tl, span);
    var c = el(seq, 'cadre');
    var sur = p.surtitre ? el(c, 'surtitre', esc(p.surtitre)) : null;
    var zone = el(c, 'defile');
    zone.style.height = (PORTRAIT ? 34 : 30) + 'rem';
    var mots = p.mots || [];
    var debut = sur ? .45 : .1;
    var chacun = (span - debut - .25) / Math.max(1, mots.length);
    if (sur) {
      sur.style.position = 'absolute';
      sur.style.top = (PORTRAIT ? 30 : 16) + '%';
      tl.from(sur, { opacity: 0, y: 2 * U, filter: 'blur(8px)', duration: .5, ease: 'power2.out' }, 0);
    }
    mots.forEach(function (m, i) {
      var ligne = lettres(zone, m);
      ajuster(ligne, largeurUtile(PORTRAIT ? .98 : .92), PORTRAIT ? 30 : 34);
      var t = debut + i * chacun;
      var ls = ligne.querySelectorAll('.mot');
      tl.fromTo(ls, { yPercent: 55, opacity: 0, filter: 'blur(18px)' },
        { yPercent: 0, opacity: 1, filter: 'blur(0px)', duration: .42, stagger: .028, ease: 'expo.out' }, t);
      tl.fromTo(ligne, { scale: 1.08, x: 3 * U }, { scale: 1, x: -2 * U, duration: chacun + .3, ease: 'none' }, t);
      if (i < mots.length - 1 || p.garder === false) {
        tl.to(ls, { yPercent: -45, opacity: 0, filter: 'blur(14px)', duration: .26, stagger: .012, ease: 'power2.in' }, t + chacun - .24);
      }
    });
  };

  /* Traînées de lumière qui filent sur le sol, et une phrase qui s'allume. */
  PLANS.comete = function (seq, p, tl, span) {
    decorSol(seq, tl, span);
    var c = el(seq, 'cadre');
    var angle = PORTRAIT ? -58 : -24;
    [[.2, .75, 1], [.55, .95, .55], [.9, .6, .35]].forEach(function (d, i) {
      var cm = el(seq, 'comete');
      var long = (PORTRAIT ? 60 : 70) * U * d[2];
      cm.style.width = long + 'px';
      cm.style.left = '0px'; cm.style.top = '0px';
      var x0 = W * 1.15, y0 = H * (PORTRAIT ? .1 : .18) + i * 9 * U;
      var x1 = -W * .2, y1 = y0 + Math.tan(-angle * Math.PI / 180) * (x0 - x1) * (PORTRAIT ? .35 : 1);
      tl.fromTo(cm, { x: x0, y: y0, rotation: angle, opacity: d[1] },
        { x: x1, y: y1, duration: .9 + i * .15, ease: 'power1.in' }, d[0] * (span - .9));
    });
    if (p.phrase) {
      var ph = el(c, 'phrase');
      ph.style.fontSize = (PORTRAIT ? 5.2 : 4.6) + 'rem';
      ph.style.marginTop = '-24rem';
      ph.innerHTML = esc(p.phrase).replace(/\*([^*]+)\*/g, '<b class="glace" style="font-family:\'Playfair Display\',serif;font-style:italic;font-weight:600">$1</b>');
      tl.from(ph, { opacity: 0, y: 2 * U, filter: 'blur(12px)', duration: .7, ease: 'power2.out' }, .25);
    }
  };

  /* Une pièce aux couleurs d'Odile, posée sur le sol, que la lumière balaie. */
  PLANS.objet = function (seq, p, tl, span) {
    decorSol(seq, tl, span);
    var o = el(seq, 'objet');
    if (PORTRAIT) o.style.top = '58%';
    var ombre = el(o, 'ombre');
    var piece = el(o, 'piece');
    el(piece, 'tranche');
    var face = el(piece, 'face');
    var reflet = el(face, 'reflet');
    if (LOGO) { var l = el(face, 'lettre'); img(l); }
    tl.fromTo(piece, { y: -44 * U, opacity: 0, scale: .82 }, { y: 0, opacity: 1, scale: 1, duration: .95, ease: 'bounce.out' }, .1);
    tl.fromTo(ombre, { opacity: 0, scaleX: .4 }, { opacity: 1, scaleX: 1, duration: .95, ease: 'bounce.out' }, .1);
    tl.fromTo(reflet, { xPercent: -160 }, { xPercent: 560, duration: 1.1, ease: 'power2.inOut' }, .95);
    tl.to(o, { scale: 1.12, duration: span, ease: 'none' }, 0);
    tl.to(ombre, { opacity: .55, duration: .5, yoyo: true, repeat: Math.max(1, Math.floor(span / .5) - 1), ease: 'sine.inOut' }, 1.05);
    if (p.phrase) {
      var c = el(seq, 'cadre');
      var ph = el(c, 'surtitre', esc(p.phrase));
      ph.style.marginTop = (PORTRAIT ? -86 : -58) + 'rem';
      tl.from(ph, { opacity: 0, letterSpacing: '.6em', duration: .8, ease: 'power2.out' }, .6);
    }
  };

  /* Révélation : « Voici » + logo, flous puis nets, sous un projecteur. */
  PLANS.revelation = function (seq, p, tl, span) {
    decorMur(seq, tl, span, { reperes: false });
    var f = seq.querySelector('.fond');
    [[.18, .3], [.5, .22], [.84, .44], [.3, .78], [.72, .82]].forEach(function (pos, i) {
      var lo = el(f, 'losange');
      lo.style.left = (W * pos[0]) + 'px'; lo.style.top = (H * pos[1]) + 'px';
      tl.fromTo(lo, { opacity: 0, scale: 0 }, { opacity: 1, scale: 1, duration: .4, ease: 'back.out(2)' }, .15 + i * .09);
    });
    decorProjecteur(seq, tl, span, PORTRAIT ? [.5, 1.02] : [.82, 1.05]);
    var c = el(seq, 'cadre');
    var rang = el(c, 'revele');
    var avant = p.avant ? motsTexte(rang, p.avant, 'chrome') : null;
    var logo = img(rang);
    if (avant) avant.style.fontSize = (PORTRAIT ? 12 : 13) + 'rem';
    tl.fromTo(rang, { opacity: 0, filter: 'blur(36px)', scale: 1.14, letterSpacing: '.08em' },
      { opacity: 1, filter: 'blur(0px)', scale: 1, letterSpacing: '0em', duration: 1.25, ease: 'power3.out' }, .2);
    tl.fromTo(logo, { filter: 'drop-shadow(0 0 0rem rgba(170,215,255,0)) brightness(2)' },
      { filter: 'drop-shadow(0 0 3.4rem rgba(170,215,255,.6)) brightness(1)', duration: 1.2, ease: 'power2.out' }, .7);
    tl.to(rang, { scale: 1.04, duration: span - 1.4, ease: 'none' }, 1.45);
    if (p.sous) {
      var s = el(c, 'phrase', esc(p.sous));
      s.style.marginTop = '5rem';
      tl.from(s, { opacity: 0, y: 1.5 * U, duration: .6, ease: 'power2.out' }, 1.2);
    }
  };

  /* Téléphone : un écran de l'outil qui se remplit tout seul, puis la confirmation. */
  PLANS.telephone = function (seq, p, tl, span) {
    decorMur(seq, tl, span, { reperes: false });
    var c = el(seq, 'cadre');
    var duo = el(c, 'duo');
    var texte = el(duo, 'texte');
    if (p.surtitre) el(texte, 'surtitre', esc(p.surtitre));
    var lignes = (p.titre || []).map(function (l) {
      var n = motsTexte(texte, l);
      ajuster(n, PAYSAGE ? 74 * U : largeurUtile(), PAYSAGE ? 11.5 : PORTRAIT ? 11 : 9);
      return n;
    });
    var tel = el(duo, 'telephone');
    if (PAYSAGE) { tel.style.height = '80rem'; tel.style.width = '40rem'; }
    el(tel, 'encoche');
    var ecran = el(tel, 'ecran');
    var e = p.ecran || {};
    el(ecran, 'petit', esc(e.surtitre || FILM.marque.nom));
    el(ecran, '', '<h4>' + esc(e.titre || '') + '</h4>');
    var champs = (e.champs || []).map(function (ch) {
      var bloc = el(ecran, 'ligne-champ');
      el(bloc, 'petit', esc(ch.label));
      var v = el(bloc, 'val');
      var t = el(v, 't', esc(ch.valeur));
      t.style.display = 'inline-block';
      var caret = el(v, 'caret');
      return { t: t, caret: caret, n: String(ch.valeur).length };
    });
    var bouton = el(ecran, 'envoyer', esc(e.bouton || 'Envoyer'));
    var toast = el(tel, 'toast', '<div class="ok">' + icone('coche') + '</div><div>' + esc(e.confirmation || 'Envoyé') + '</div>');

    // Entrées
    lignes.forEach(function (n, i) {
      tl.fromTo(n.children, { yPercent: 70, opacity: 0, filter: 'blur(14px)' },
        { yPercent: 0, opacity: 1, filter: 'blur(0px)', duration: .6, stagger: .07, ease: 'expo.out' }, .1 + i * .18);
    });
    tl.fromTo(tel, { y: 30 * U, rotationX: 18, opacity: 0, transformPerspective: 200 * U },
      { y: 0, rotationX: 0, opacity: 1, duration: .9, ease: 'expo.out' }, .15);
    tl.to(tel, { y: -3 * U, duration: span, ease: 'none' }, 1.05);
    // Saisie automatique, champ après champ (le curseur de texte suit)
    var t0 = .9, dureeChamp = Math.min(.75, (span - 2.6) / Math.max(1, champs.length));
    champs.forEach(function (ch, i) {
      var t = t0 + i * dureeChamp;
      tl.set(ch.caret, { opacity: 0 }, 0);
      tl.set(ch.caret, { opacity: 1 }, t);
      tl.fromTo(ch.t, { clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)', duration: dureeChamp * .8, ease: 'steps(' + Math.max(4, ch.n) + ')' }, t);
      tl.set(ch.caret, { opacity: 0 }, t + dureeChamp);
    });
    var tBouton = t0 + champs.length * dureeChamp + .1;
    tl.to(bouton, { scale: .94, duration: .12, yoyo: true, repeat: 1, ease: 'power1.inOut' }, tBouton);
    tl.fromTo(toast, { yPercent: -160, opacity: 0 }, { yPercent: 0, opacity: 1, duration: .55, ease: 'back.out(1.6)' }, tBouton + .3);
    tl.from(toast.querySelector('.ok'), { scale: 0, rotation: -90, duration: .45, ease: 'back.out(2.4)' }, tBouton + .5);
  };

  /* Tuiles : l'offre, trois cartes qui se lèvent sur le sol ; la vedette s'allume. */
  PLANS.tuiles = function (seq, p, tl, span) {
    decorSol(seq, tl, span);
    var c = el(seq, 'cadre');
    if (p.surtitre) {
      var s = el(c, 'surtitre', esc(p.surtitre));
      s.style.marginBottom = '5rem';
      tl.from(s, { opacity: 0, y: 1.5 * U, duration: .5, ease: 'power2.out' }, 0);
    }
    var rang = el(c, 'tuiles');
    var cartes = (p.tuiles || []).map(function (t) {
      var n = el(rang, 'tuile' + (t.vedette ? ' vedette' : ''));
      el(n, 'ico', icone(t.icone));
      var txt = el(n, '');
      el(txt, 'nom', esc(t.nom));
      if (t.desc) el(txt, 'desc', esc(t.desc));
      return n;
    });
    tl.fromTo(cartes, { y: 24 * U, rotationX: -35, opacity: 0, transformPerspective: 120 * U },
      { y: 0, rotationX: 0, opacity: 1, duration: .9, stagger: .14, ease: 'expo.out' }, .2);
    var vedette = rang.querySelector('.vedette');
    if (vedette) {
      tl.to(vedette, { y: -3 * U, boxShadow: '0 4rem 10rem rgba(0,120,255,.35), inset 0 1px 0 rgba(255,255,255,.2)', borderColor: 'rgba(120,200,255,.6)', duration: .7, ease: 'power2.out' }, 1.35);
    }
    tl.to(rang, { scale: 1.04, duration: span, ease: 'none' }, 0);
  };

  /* Flux : les étapes s'allument l'une après l'autre, reliées par un trait de lumière. */
  PLANS.flux = function (seq, p, tl, span) {
    decorMur(seq, tl, span);
    var c = el(seq, 'cadre');
    if (p.surtitre) {
      var s = el(c, 'surtitre', esc(p.surtitre));
      s.style.marginBottom = '3rem';
      tl.from(s, { opacity: 0, y: 1.5 * U, duration: .5, ease: 'power2.out' }, 0);
    }
    if (p.titre) {
      var t = motsTexte(c, p.titre);
      ajuster(t, largeurUtile(), PAYSAGE ? 8 : 7.4);
      t.style.marginBottom = '7rem';
      tl.fromTo(t.children, { yPercent: 70, opacity: 0, filter: 'blur(12px)' }, { yPercent: 0, opacity: 1, filter: 'blur(0px)', duration: .55, stagger: .05, ease: 'expo.out' }, .1);
    }
    var flux = el(c, 'flux');
    var noeuds = p.noeuds || [];
    var pas = (span - 1.6) / Math.max(1, noeuds.length);
    noeuds.forEach(function (nd, i) {
      if (i > 0) {
        var lien = el(flux, 'lien');
        var plein = el(lien, 'plein');
        tl.fromTo(plein, PORTRAIT ? { scaleY: 0 } : { scaleX: 0 }, PORTRAIT ? { scaleY: 1, duration: pas * .6, ease: 'power2.inOut' } : { scaleX: 1, duration: pas * .6, ease: 'power2.inOut' }, .9 + (i - 1) * pas + pas * .3);
      }
      var n = el(flux, 'noeud');
      var rond = el(n, 'rond', icone(nd.icone));
      el(n, 'nom', esc(nd.nom));
      var tAllume = .9 + i * pas;
      tl.from(n, { opacity: 0, y: 3 * U, duration: .45, ease: 'power2.out' }, .35 + i * .08);
      tl.to(rond, { borderColor: 'rgba(120,200,255,.9)', color: '#ffffff', backgroundColor: '#0a3a70', boxShadow: '0 0 4rem rgba(0,153,255,.55)', duration: .35, ease: 'power2.out' }, tAllume);
      tl.fromTo(rond, { scale: 1 }, { scale: 1.08, duration: .18, yoyo: true, repeat: 1, ease: 'power1.inOut' }, tAllume);
    });
  };

  /* Carte de fin : logo, promesse, bouton cliqué, adresse. */
  PLANS.fin = function (seq, p, tl, span) {
    decorProjecteur(seq, tl, span, [.5, 1.1]);
    var c = el(seq, 'cadre');
    var bloc = el(c, 'fin');
    var logo = img(bloc);
    var ph = p.phrase ? el(bloc, 'phrase', esc(p.phrase)) : null;
    if (ph) ph.style.fontSize = (PORTRAIT ? 4.4 : 3.8) + 'rem';
    var bouton = p.bouton ? el(bloc, 'bouton', esc(p.bouton)) : null;
    var url = p.url ? el(bloc, 'url', esc(p.url)) : null;
    tl.fromTo(logo, { opacity: 0, filter: 'blur(30px) drop-shadow(0 0 0 rgba(0,0,0,0))', scale: 1.2 },
      { opacity: 1, filter: 'blur(0px) drop-shadow(0 0 3rem rgba(170,215,255,.45))', scale: 1, duration: 1, ease: 'power3.out' }, .1);
    if (ph) tl.from(ph, { opacity: 0, y: 2 * U, filter: 'blur(10px)', duration: .6, ease: 'power2.out' }, .7);
    if (bouton) {
      tl.from(bouton, { opacity: 0, y: 4 * U, scale: .9, duration: .6, ease: 'back.out(1.8)' }, 1.05);
      var onde = el(bouton, 'onde');
      var curseur = el(c, 'curseur', CURSEUR);
      var tClic = Math.min(span - 1, 2.3);
      tl.set(onde, { opacity: 0 }, 0);
      tl.fromTo(curseur, { x: W * .78, y: H * .92, opacity: 0 }, { opacity: 1, duration: .2 }, tClic - .9);
      // Le curseur rejoint le bouton (sa position est lue au moment de construire la scène)
      var cible = function () {
        var r = bouton.getBoundingClientRect();
        return { x: r.left + r.width * .62, y: r.top + r.height * .58 };
      };
      var fin = cible();
      tl.to(curseur, { x: fin.x, y: fin.y, duration: .75, ease: 'power3.inOut' }, tClic - .8);
      tl.to(bouton, { scale: .95, duration: .1, yoyo: true, repeat: 1, ease: 'power1.inOut' }, tClic);
      tl.fromTo(onde, { opacity: .95, scale: .3 }, { opacity: 0, scale: 3.2, duration: .7, ease: 'power2.out' }, tClic + .02);
      tl.to(curseur, { opacity: 0, duration: .3 }, tClic + .7);
    }
    if (url) tl.from(url, { opacity: 0, letterSpacing: '.5em', duration: .8, ease: 'power2.out' }, 1.3);
  };

  // ---- Montage : chaque séquence à sa place sur la timeline maîtresse ------------------------
  function construire() {
    var stage = document.getElementById('stage');
    var params = new URLSearchParams(location.search);
    var seule = params.get('section');
    var sections = FILM.sections.filter(function (s) { return !seule || s.id === seule; });
    var master = gsap.timeline({ paused: true });
    var t0 = 0, fondu = .16, repere = [];
    sections.forEach(function (s, i) {
      var seq = el(stage, 'sequence');
      seq.dataset.section = s.id;
      var tl = gsap.timeline();
      var plan = PLANS[s.plan];
      if (!plan) throw new Error('Plan inconnu : ' + s.plan);
      // La mise en page doit exister (visible) pour être mesurée : on la construit
      // visible, puis la timeline maîtresse la masque et la révèle à son heure.
      seq.style.visibility = 'visible';
      plan(seq, s, tl, s.duree);
      master.add(tl, t0);
      master.fromTo(seq, { autoAlpha: 0 }, { autoAlpha: 1, duration: i === 0 ? .01 : fondu * 2, ease: 'power1.out', immediateRender: true }, Math.max(0, t0 - (i === 0 ? 0 : fondu)));
      if (i < sections.length - 1) master.to(seq, { autoAlpha: 0, duration: fondu * 2, ease: 'power1.in' }, t0 + s.duree - fondu);
      repere.push({ id: s.id, titre: s.titre, debut: t0, duree: s.duree });
      t0 += s.duree;
    });
    master.seek(0);
    window.__motion = {
      duree: t0,
      fps: FILM.fps,
      sections: repere,
      seek: function (t) { master.time(Math.max(0, Math.min(t, t0)), false); return true; },
    };
    document.body.dataset.pret = '1';
  }

  (document.fonts ? document.fonts.ready : Promise.resolve()).then(function () {
    // Les images (logo) doivent être décodées avant de mesurer la mise en page.
    var imgs = LOGO ? [new Promise(function (ok) { var i = new Image(); i.onload = i.onerror = ok; i.src = LOGO; })] : [];
    return Promise.all(imgs);
  }).then(construire).catch(function (err) {
    document.body.dataset.erreur = String(err && err.message || err);
    throw err;
  });
})();
