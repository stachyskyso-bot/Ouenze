// ============================================================
// ACCOUNT.JS — « Mon compte » : profil et espaces (client, vendeur, livreur)
//
//   OuenzeAccount.open({ current, shops, activeShop, onShopChange })
//       current      : espace où l'on se trouve ('client' | 'vendeur' | 'livreur')
//       shops        : boutiques du vendeur [{ id, name, logo }] → choix de la boutique active
//   OuenzeAccount.editProfile(onSaved)
//
// Fichier autonome (fonctionne aussi sur l'espace vendeur, qui ne charge pas app.js).
// Données : migration 20261113_account_spaces.sql (my_spaces, set_my_home_space, update_my_profile).
// Devenir vendeur ou livreur passe toujours par une demande validée par l'équipe.
// ============================================================

(function () {
    'use strict';

    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const safeImg = u => /^(https:\/\/|data:image\/(jpeg|png|webp);base64,)/i.test(String(u || '')) ? String(u).replace(/"/g, '%22') : '';
    const sb = () => window.supabase;
    const LABEL = { client: 'Client', vendeur: 'Vendeur', livreur: 'Livreur', admin: 'Administrateur' };
    const PAGE = { client: 'index.html', vendeur: 'vendor-dashboard.html', livreur: 'delivery-dashboard.html' };

    let box = null;
    let opts = {};
    let me = null;

    function injectCss() {
        if (document.getElementById('acCss')) return;
        const l = document.createElement('link');
        l.id = 'acCss';
        l.rel = 'stylesheet';
        l.href = 'css/account.css';
        document.head.appendChild(l);
    }

    function close() {
        box?.remove();
        box = null;
        document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }

    function sheet(html, cls) {
        close();
        injectCss();
        box = document.createElement('div');
        box.className = 'ac-wrap';
        box.innerHTML = `<div class="ac-sheet ${cls || ''}" role="dialog" aria-modal="true"><button type="button" class="ac-x" aria-label="Fermer">&times;</button>${html}</div>`;
        document.body.appendChild(box);
        box.querySelector('.ac-x').onclick = close;
        box.addEventListener('click', e => { if (e.target === box) close(); });
        document.addEventListener('keydown', onKey);
        return box;
    }

    function missingDb(e) { return /my_spaces|update_my_profile|set_my_home_space|schema cache|does not exist/i.test(e?.message || ''); }
    const DB_TEXT = 'Base de données à mettre à jour (migration 20261113_account_spaces.sql).';

    async function load() {
        const { data, error } = await sb().rpc('my_spaces');
        if (error) throw error;
        me = data || {};
        return me;
    }

    async function userInfo() {
        try {
            const { data } = await sb().auth.getSession();
            return data?.session?.user || null;
        } catch (e) { return null; }
    }

    // Raccourcis de l'application (cache du type d'espace : voir sendTeamToTheirSpace dans app.js)
    function rememberType(uid, type) {
        try { if (uid) localStorage.setItem('ouenze_type_' + uid, type); } catch (e) { /* rien */ }
    }

    // ---------- Mon compte ----------
    async function open(o = {}) {
        opts = o;
        sheet('<p class="ac-loading"><i class="fas fa-spinner fa-spin"></i> Chargement…</p>');
        const user = await userInfo();
        if (!user) { close(); location.href = 'index.html'; return; }
        try {
            await load();
        } catch (e) {
            sheet(`<h3>Mon compte</h3><p class="ac-err">${esc(missingDb(e) ? DB_TEXT : e.message)}</p>`);
            return;
        }
        render(user);
    }

    function spaceRow(kind, icon, title, status) {
        const here = (opts.current || 'client') === kind;
        let right = '', sub = '';
        if (kind === 'client') {
            sub = 'Acheter sur Ouenze comme un client';
            right = here ? '<span class="ac-here">Tu es ici</span>'
                : `<button type="button" class="ac-btn" data-go="client"><i class="fas fa-shopping-bag"></i> Passer en mode client</button>`;
        } else if (status === 'approved') {
            sub = kind === 'vendeur' ? `${Number(me.shops) || 0} boutique${Number(me.shops) > 1 ? 's' : ''}` : 'Livraisons et gains';
            right = here ? '<span class="ac-here">Tu es ici</span>'
                : `<button type="button" class="ac-btn" data-go="${kind}"><i class="fas fa-arrow-right"></i> Ouvrir</button>`;
        } else if (status === 'pending') {
            sub = 'Demande envoyée';
            right = '<span class="ac-state wait"><i class="fas fa-hourglass-half"></i> En cours d\'examen</span>';
        } else if (status === 'suspended') {
            sub = 'Espace suspendu par l\'équipe Ouenze';
            right = '<a class="ac-link" href="help.html">Contacter l\'aide</a>';
        } else {
            const reg = kind === 'vendeur' ? 'vendor-register.html' : 'delivery-register.html';
            sub = status === 'rejected' ? 'Demande refusée' : (kind === 'vendeur' ? 'Vends tes produits sur Ouenze' : 'Livre et gagne de l\'argent');
            right = `<a class="ac-btn ghost" href="${reg}">${status === 'rejected' ? 'Refaire une demande' : `Devenir ${kind}`}</a>`;
        }
        return `<div class="ac-space ${here ? 'here' : ''}">
            <span class="ac-space-ico"><i class="fas ${icon}"></i></span>
            <span class="ac-space-txt"><b>${title}</b><small>${esc(sub)}</small></span>
            ${right}</div>`;
    }

    function render(user) {
        const name = me.full_name || user.user_metadata?.full_name || 'Mon compte';
        const avatar = safeImg(me.avatar_url);
        const contact = me.phone || user.phone || user.email || '';
        const shops = (opts.shops || []).filter(s => s && s.id);
        const choices = ['client', ...(me.vendor === 'approved' ? ['vendeur'] : []), ...(me.courier === 'approved' ? ['livreur'] : [])];
        const canChoose = !me.admin && me.type !== 'admin' && choices.length > 1;
        const home = choices.includes(me.home) ? me.home : 'client';

        sheet(`
            <div class="ac-head">
                <span class="ac-avatar">${avatar ? `<img src="${avatar}" alt="">` : esc(name.trim().charAt(0).toUpperCase())}</span>
                <div><h3>${esc(name)}</h3><small>${esc(contact)}</small>
                    <span class="ac-badge">${esc(me.admin ? 'Administrateur' : 'Espace principal : ' + (LABEL[me.home] || 'Client'))}</span></div>
            </div>
            <button type="button" class="ac-edit"><i class="fas fa-user-edit"></i> Modifier mon profil</button>

            ${shops.length > 1 ? `<h4>Boutique active</h4>
                <p class="ac-hint">Le tableau de bord, les commandes et les stories n'affichent que cette boutique.</p>
                <div class="ac-shops">
                    <button type="button" class="ac-shop ${!opts.activeShop ? 'on' : ''}" data-shop=""><span class="ac-shop-logo"><i class="fas fa-layer-group"></i></span><span>Toutes mes boutiques</span></button>
                    ${shops.map(s => `<button type="button" class="ac-shop ${opts.activeShop === s.id ? 'on' : ''}" data-shop="${esc(s.id)}">
                        <span class="ac-shop-logo">${safeImg(s.logo) ? `<img src="${safeImg(s.logo)}" alt="">` : esc((s.name || '?').trim().charAt(0).toUpperCase())}</span>
                        <span>${esc(s.name)}</span></button>`).join('')}
                </div>` : ''}

            <h4>Mes espaces</h4>
            <div class="ac-spaces">
                ${spaceRow('client', 'fa-shopping-bag', 'Client', 'approved')}
                ${spaceRow('vendeur', 'fa-store', 'Vendeur', me.vendor)}
                ${spaceRow('livreur', 'fa-motorcycle', 'Livreur', me.courier)}
            </div>

            ${canChoose ? `<h4>Espace à l'ouverture de l'application</h4>
                <p class="ac-hint">Ton compte principal : l'espace qui s'ouvre quand tu lances Ouenze.</p>
                <div class="ac-types">${choices.map(t => `<button type="button" class="ac-type ${home === t ? 'on' : ''}" data-type="${t}">${LABEL[t]}</button>`).join('')}</div>
                <p class="ac-msg" hidden></p>` : ''}
        `, 'ac-account');

        box.querySelector('.ac-edit').onclick = () => editProfile(() => open(opts));
        box.querySelectorAll('[data-go]').forEach(b => b.onclick = () => go(b.dataset.go));
        box.querySelectorAll('.ac-shop').forEach(b => b.onclick = () => {
            const id = b.dataset.shop || '';
            close();
            if (typeof opts.onShopChange === 'function') opts.onShopChange(id);
        });
        box.querySelectorAll('.ac-type').forEach(b => b.onclick = () => setType(b.dataset.type, user));
    }

    function go(kind) {
        try {
            if (kind === 'client') {
                sessionStorage.setItem('ouenzeSiteView', '1');
                // Espace d'où l'on vient : bouton « Retour à mon espace » en mode client
                if (opts.current === 'vendeur' || opts.current === 'livreur') sessionStorage.setItem('ouenzeFromSpace', opts.current);
            } else {
                sessionStorage.removeItem('ouenzeSiteView');
                sessionStorage.removeItem('ouenzeFromSpace');
            }
        } catch (e) { /* rien */ }
        location.href = kind === 'client' ? 'index.html?site=1' : PAGE[kind];
    }

    async function setType(type, user) {
        if (!box || type === me.home) return;
        const msg = box.querySelector('.ac-msg');
        box.querySelectorAll('.ac-type').forEach(b => { b.disabled = true; });
        const { data, error } = await sb().rpc('set_my_home_space', { target: type });
        box?.querySelectorAll('.ac-type').forEach(b => { b.disabled = false; });
        if (!box) return;
        if (error) {
            msg.hidden = false;
            msg.className = 'ac-msg err';
            msg.textContent = missingDb(error) ? DB_TEXT : error.message;
            return;
        }
        me.home = data || type;
        rememberType(user.id, me.home);
        box.querySelectorAll('.ac-type').forEach(b => b.classList.toggle('on', b.dataset.type === me.home));
        box.querySelector('.ac-badge').textContent = 'Espace principal : ' + (LABEL[me.home] || 'Client');
        msg.hidden = false;
        msg.className = 'ac-msg ok';
        msg.textContent = `C'est noté : Ouenze s'ouvrira sur ton espace ${LABEL[me.home].toLowerCase()}.`;
    }

    // ---------- Modifier mon profil ----------
    function compress(file) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => {
                const size = 320;
                const side = Math.min(img.width, img.height);
                const c = document.createElement('canvas');
                c.width = c.height = size;
                const ctx = c.getContext('2d');
                ctx.fillStyle = '#fff';
                ctx.fillRect(0, 0, size, size);
                // carré centré
                ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
                URL.revokeObjectURL(url);
                let q = 0.82, out = c.toDataURL('image/jpeg', q);
                while (out.length > 140000 && q > 0.4) { q -= 0.1; out = c.toDataURL('image/jpeg', q); }
                resolve(out);
            };
            img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Photo illisible')); };
            img.src = url;
        });
    }

    async function editProfile(onSaved) {
        const user = await userInfo();
        if (!user) { location.href = 'index.html'; return; }
        if (!me) {
            try { await load(); } catch (e) { sheet(`<h3>Modifier mon profil</h3><p class="ac-err">${esc(missingDb(e) ? DB_TEXT : e.message)}</p>`); return; }
        }
        let avatar = safeImg(me.avatar_url);
        const name = me.full_name || user.user_metadata?.full_name || '';
        sheet(`
            <h3>Modifier mon profil</h3>
            <div class="ac-photo">
                <span class="ac-avatar big">${avatar ? `<img src="${avatar}" alt="">` : esc((name || '?').trim().charAt(0).toUpperCase())}</span>
                <div class="ac-photo-btns">
                    <label class="ac-btn ghost"><input type="file" accept="image/*" hidden> <i class="fas fa-camera"></i> Changer la photo</label>
                    <button type="button" class="ac-link ac-photo-del" ${avatar ? '' : 'hidden'}>Retirer la photo</button>
                </div>
            </div>
            <label class="ac-l">Nom complet<input type="text" class="ac-name" maxlength="80" autocomplete="name" value="${esc(name)}"></label>
            <label class="ac-l">Téléphone de contact<input type="tel" class="ac-phone" maxlength="20" autocomplete="tel" placeholder="+242 06 000 00 00" value="${esc(me.phone || user.user_metadata?.phone || user.phone || '')}"></label>
            <label class="ac-l">Ville<input type="text" class="ac-city" maxlength="60" placeholder="Brazzaville" value="${esc(me.city || user.user_metadata?.city || '')}"></label>
            ${user.email ? `<div class="ac-l">Email<div class="ac-ro">${esc(user.email)}</div></div>` : ''}
            <p class="ac-hint">Le téléphone sert aux livreurs et à l'équipe pour te joindre. Ton numéro de connexion ne change pas.</p>
            <p class="ac-msg err" hidden></p>
            <button type="button" class="ac-save"><i class="fas fa-check"></i> Enregistrer</button>
        `, 'ac-profile');
        const q = s => box.querySelector(s);
        const err = t => { const m = q('.ac-msg'); m.hidden = !t; m.textContent = t || ''; };
        q('.ac-photo input').onchange = async e => {
            const f = e.target.files?.[0];
            if (!f) return;
            if (!/^image\//.test(f.type)) return err('Choisis une photo.');
            try {
                avatar = await compress(f);
                q('.ac-avatar').innerHTML = `<img src="${avatar}" alt="">`;
                q('.ac-photo-del').hidden = false;
                err('');
            } catch (x) { err(x.message); }
        };
        q('.ac-photo-del').onclick = () => {
            avatar = '';
            q('.ac-avatar').textContent = (q('.ac-name').value || '?').trim().charAt(0).toUpperCase();
            q('.ac-photo-del').hidden = true;
        };
        q('.ac-save').onclick = async () => {
            const btn = q('.ac-save');
            const fullName = q('.ac-name').value.trim().replace(/\s+/g, ' ');
            const phone = q('.ac-phone').value.trim();
            const city = q('.ac-city').value.trim();
            if (fullName.length < 2) return err('Indique ton nom.');
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enregistrement…';
            const { data, error } = await sb().rpc('update_my_profile', { name: fullName, phone: phone || null, city: city || null, avatar: avatar || null });
            if (error) {
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-check"></i> Enregistrer';
                return err(missingDb(error) ? DB_TEXT : error.message);
            }
            me = data || me;
            // Nom aussi dans le compte de connexion (en-têtes, emails)
            try {
                Promise.resolve(sb().auth.updateUser({ data: { full_name: fullName, ...(city ? { city } : {}) } })).catch(() => {});
            } catch (e) { /* le profil est déjà enregistré */ }
            close();
            window.dispatchEvent(new CustomEvent('ouenze:profile', { detail: me }));
            if (typeof onSaved === 'function') onSaved(me);
            else if (window.uiAlert) window.uiAlert('Profil enregistré.');
        };
    }

    window.OuenzeAccount = { open, editProfile, close, info: () => me };
})();
