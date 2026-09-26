/* =========================================================================
   Bazar Colibrí — interacción de la página
   ========================================================================= */
(function () {
  const cfg = window.BAZAR_CONFIG || {};
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];

  document.getElementById('year').textContent = new Date().getFullYear();

  /* ---------- Toast ---------- */
  const toast = $('#toast');
  let toastTimer;
  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('is-on'), 3200);
  }

  /* ---------- Navegación ---------- */
  const nav = $('#nav');
  const toggle = $('.nav__toggle');
  const links = $('#nav-links');
  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!open));
    links.classList.toggle('is-open', !open);
  });
  $$('a', links).forEach((a) => a.addEventListener('click', () => {
    toggle.setAttribute('aria-expanded', 'false');
    links.classList.remove('is-open');
  }));

  const sections = $$('main section[id]');
  const navLinks = $$('.nav__links a[href^="#"]');
  function onScroll() {
    const y = window.scrollY;
    nav.classList.toggle('is-scrolled', y > 40);
    document.documentElement.style.setProperty('--scroll', String(Math.min(y / window.innerHeight, 1)));
    let current = sections[0].id;
    for (const s of sections) {
      if (s.getBoundingClientRect().top < window.innerHeight * 0.4) current = s.id;
    }
    navLinks.forEach((a) => a.classList.toggle('is-current', a.getAttribute('href') === '#' + current));
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---------- Aparición al hacer scroll ---------- */
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) {
        e.target.classList.add('is-visible');
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
  $$('.reveal').forEach((el) => {
    // escalonado dentro de cada grupo
    const siblings = $$(':scope > .reveal', el.parentElement);
    el.style.setProperty('--i', String(siblings.indexOf(el)));
    io.observe(el);
  });

  /* ---------- Inclinación 3D de tarjetas ---------- */
  if (!reduceMotion && window.matchMedia('(hover: hover)').matches) {
    $$('.tilt').forEach((card) => {
      card.addEventListener('pointermove', (e) => {
        const r = card.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width;
        const py = (e.clientY - r.top) / r.height;
        card.style.setProperty('--rx', ((0.5 - py) * 14).toFixed(2) + 'deg');
        card.style.setProperty('--ry', ((px - 0.5) * 16).toFixed(2) + 'deg');
        card.style.setProperty('--mx', (px * 100).toFixed(1) + '%');
        card.style.setProperty('--my', (py * 100).toFixed(1) + '%');
      });
      card.addEventListener('pointerleave', () => {
        card.style.setProperty('--rx', '0deg');
        card.style.setProperty('--ry', '0deg');
      });
    });
  }

  /* ---------- Filtros del catálogo ---------- */
  const chips = $$('.chip');
  const products = $$('.product');
  chips.forEach((chip) => chip.addEventListener('click', () => {
    const f = chip.dataset.filter;
    chips.forEach((c) => {
      const on = c === chip;
      c.classList.toggle('is-active', on);
      c.setAttribute('aria-selected', String(on));
    });
    products.forEach((p) => {
      const show = f === 'todo' || p.dataset.category === f;
      p.classList.toggle('is-hidden', !show);
    });
  }));

  /* ---------- Contacto directo ---------- */
  const contactUrl = {
    whatsapp: cfg.whatsapp ? 'https://wa.me/' + cfg.whatsapp.replace(/\D/g, '') + '?text=' + encodeURIComponent('¡Hola Bazar Colibrí! Quiero más información.') : '',
    instagram: cfg.instagram ? 'https://instagram.com/' + cfg.instagram.replace(/^@/, '') : '',
    email: cfg.email ? 'mailto:' + cfg.email + '?subject=' + encodeURIComponent('Contacto Bazar Colibrí') : '',
  };
  $$('[data-contact]').forEach((a) => {
    const url = contactUrl[a.dataset.contact];
    if (url) {
      a.href = url;
      if (!url.startsWith('mailto:')) {
        a.target = '_blank';
        a.rel = 'noopener';
      }
    } else {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        showToast('Este canal estará disponible muy pronto.');
      });
    }
  });

  /* ---------- Formulario de postulación ---------- */
  const form = $('#join-form');
  const note = $('#form-note');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    let ok = true;
    $$('[required]', form).forEach((field) => {
      const bad = !field.value.trim();
      field.closest('.field').classList.toggle('is-invalid', bad);
      if (bad) ok = false;
    });
    if (!ok) {
      note.textContent = 'Completa los campos marcados para continuar.';
      return;
    }
    const data = Object.fromEntries(new FormData(form));
    const text = [
      'Postulación Bazar Colibrí',
      'Nombre: ' + data.nombre,
      'Emprendimiento: ' + data.emprendimiento,
      'Categoría: ' + data.categoria,
      data.redes ? 'Redes: ' + data.redes : '',
      'Contacto: ' + data.contacto,
      data.mensaje ? 'Proyecto: ' + data.mensaje : '',
    ].filter(Boolean).join('\n');

    if (cfg.whatsapp) {
      window.open('https://wa.me/' + cfg.whatsapp.replace(/\D/g, '') + '?text=' + encodeURIComponent(text), '_blank', 'noopener');
    } else if (cfg.email) {
      window.location.href = 'mailto:' + cfg.email + '?subject=' + encodeURIComponent('Postulación Bazar Colibrí') + '&body=' + encodeURIComponent(text);
    } else {
      showToast('Las postulaciones abren muy pronto. ¡Gracias por tu interés!');
      return;
    }
    note.textContent = '¡Gracias! Se abrirá tu app para enviar la postulación.';
    form.reset();
  });
  $$('input, select, textarea', form).forEach((f) => f.addEventListener('input', () => {
    f.closest('.field').classList.remove('is-invalid');
  }));

  /* ---------- Destellos de tormenta en el cielo ---------- */
  const storm = $('.storm');
  if (!reduceMotion && storm) {
    const strike = () => {
      storm.classList.remove('is-strike');
      void storm.offsetWidth;
      storm.style.setProperty('--sx', (10 + Math.random() * 80).toFixed(0) + '%');
      storm.classList.add('is-strike');
      setTimeout(strike, 5000 + Math.random() * 9000);
    };
    setTimeout(strike, 3500);
  }
})();
