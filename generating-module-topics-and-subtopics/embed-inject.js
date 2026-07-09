(function(){
  var s = document.createElement('style');
  s.textContent =
    '.pm-embed-link{font-size:.82em;margin-left:.45em;color:#1a6fb4;text-decoration:none;white-space:nowrap}'
    + '.pm-embed-hub{display:inline-block;margin:10px 0;padding:7px 14px;background:#eef4fb;'
    + 'border:1px solid #cfe0f0;border-radius:8px;color:#1a3c6e;text-decoration:none;font-weight:600}';
  document.head.appendChild(s);

  function norm(h){ if(!h) return ''; h = h.split('#')[0].split('?')[0]; return h.replace(/^\.\//,''); }

  fetch('embed-artifacts.json').then(function(r){ return r.json(); }).then(function(items){
    var map = {};
    (items||[]).forEach(function(it){ map[norm(it.href)] = it; });

    document.querySelectorAll('a[href]').forEach(function(a){
      var key = norm(a.getAttribute('href'));
      if(!key || a.hasAttribute('data-pm-embed')) return;
      var it = map[key]; if(!it) return;
      a.setAttribute('data-pm-embed','1');
      var em = document.createElement('a');
      em.className = 'pm-embed-link';
      em.href = 'embed.html?u=' + encodeURIComponent(key) + '&t=' + encodeURIComponent(it.title || a.textContent.trim());
      em.textContent = '(Embed)';
      em.title = 'Get LMS embed code for this page';
      a.insertAdjacentElement('afterend', em);
    });

    var hub = document.createElement('a');
    hub.className = 'pm-embed-hub';
    hub.href = 'embed.html';
    hub.textContent = '\u{1F517} Embed a page in your LMS';
    var main = document.querySelector('main') || document.body;
    main.insertBefore(hub, main.firstChild);
  }).catch(function(){});
})();