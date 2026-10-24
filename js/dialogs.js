// ============================================================
// DIALOGS.JS — fenêtres dessinées dans la page (remplacent alert / confirm / prompt)
//
// Dans certaines applis (appli Google, Facebook, Instagram…), les fenêtres du navigateur
// sont bloquées sans rien dire : un vendeur ne pouvait pas accepter une commande, un admin
// ne pouvait pas valider un dossier… Ces fenêtres-ci fonctionnent partout.
//   await uiAlert('Texte')                      → rien
//   await uiConfirm('Texte', 'Oui', danger)     → true / false
//   await uiPrompt('Texte', 'valeur')           → texte / null (annulé)
// window.alert est aussi remplacé (non bloquant) pour les messages simples.
// À charger avant les scripts de la page. Fichier autonome (styles intégrés).
// ============================================================

(function () {
    'use strict';

    function injectStyles() {
        if (document.getElementById('uiDialogStyles')) return;
        const st = document.createElement('style');
        st.id = 'uiDialogStyles';
        st.textContent = `
            .ui-dialog{position:fixed;inset:0;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:16px;z-index:7000;}
            .ui-dialog-card{background:#fff;color:#1e293b;border-radius:16px;padding:20px;width:100%;max-width:420px;box-shadow:0 20px 50px rgba(0,0,0,.25);font-family:inherit;}
            .ui-dialog-card p{margin:0 0 14px;font-size:15px;line-height:1.45;white-space:pre-line;}
            .ui-dialog-card input{width:100%;box-sizing:border-box;padding:11px;border:1px solid #cbd5e1;border-radius:10px;font:inherit;font-size:16px;margin-bottom:14px;}
            .ui-dialog-actions{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;}
            .ui-dialog-actions button{border:none;border-radius:10px;padding:10px 16px;font:inherit;font-size:14px;font-weight:600;cursor:pointer;background:#f1f5f9;color:#1e293b;}
            .ui-dialog-actions button[data-v="1"]{background:#1e40af;color:#fff;}
            .ui-dialog-actions button.danger{background:#dc2626;}`;
        document.head.appendChild(st);
    }

    function dialog({ text, input = false, value = '', ok = 'OK', cancel = null, danger = false }) {
        return new Promise(resolve => {
            injectStyles();
            const ov = document.createElement('div');
            ov.className = 'ui-dialog';
            ov.innerHTML = `<div class="ui-dialog-card" role="dialog" aria-modal="true"><p></p>${input ? '<input type="text">' : ''}
                <div class="ui-dialog-actions">${cancel ? '<button type="button" data-v="0"></button>' : ''}<button type="button" data-v="1"></button></div></div>`;
            ov.querySelector('p').textContent = String(text ?? '');   // texte brut : jamais de HTML injecté
            ov.querySelector('button[data-v="1"]').textContent = ok;
            if (danger) ov.querySelector('button[data-v="1"]').classList.add('danger');
            if (cancel) ov.querySelector('button[data-v="0"]').textContent = cancel;
            const field = ov.querySelector('input');
            if (field) field.value = value ?? '';
            const done = v => { ov.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
            const onKey = e => {
                if (e.key === 'Escape' && cancel) done(input ? null : false);
                if (e.key === 'Enter' && (input || !cancel)) done(input ? field.value : true);
            };
            ov.addEventListener('click', e => {
                const b = e.target.closest('button[data-v]');
                if (!b) return;
                if (b.dataset.v === '0') return done(input ? null : false);
                done(input ? field.value : true);
            });
            document.addEventListener('keydown', onKey);
            document.body.appendChild(ov);
            (field || ov.querySelector('button[data-v="1"]')).focus();
        });
    }

    const uiAlert = text => dialog({ text });
    const uiConfirm = (text, ok = 'Oui', danger = false) => dialog({ text, ok, cancel: 'Annuler', danger });
    const uiPrompt = (text, value = '') => dialog({ text, input: true, value, ok: 'Valider', cancel: 'Annuler' });

    Object.assign(window, { uiAlert, uiConfirm, uiPrompt });
    // Messages simples : toujours visibles, même là où alert() est bloqué
    window.alert = msg => { uiAlert(msg); };
})();
