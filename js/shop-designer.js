// ============================================================
// SHOP-DESIGNER.JS — VERSION COMPLÈTE AVEC CARROUSEL
// ============================================================

// ============ ÉTAT GLOBAL ============
let categories = [];
let products = [];
let tempLogo = null;
let carouselMedia = [];
let carouselInterval = null;
let currentUser = null;
let currentUserEmail = null;
let editingProductId = null;
let tempVariants = [];          // combinaisons : [{ key, values:{Option:valeur}, price, stock }]
let tempVariantOptions = [];    // options : [{ name:'Couleur', values:['Noir','Blanc'] }]
let tempProductPhotos = [];
let updateTimeout = null;
let editingShopId = null;

let designConfig = {
    menuPosition: 'horizontal',
    menuBg: '#1e40af',
    menuText: '#ffffff',
    menuRadius: 0,
    carouselHeight: 300,
    carouselRadius: 12,
    carouselSpeed: 0,
    prodWidth: 200,
    prodImgHeight: 160,
    prodRadius: 12,
    prodGap: 16,
    layout: 'grid'
};

// ============ UTILITAIRES ============
function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
}

function formatNumber(v) {
    return Number(v || 0).toLocaleString('fr-FR');
}

// Réduit une photo (souvent 3–5 Mo sur smartphone) à 1000 px max en JPEG :
// pages plus légères pour les clients sur réseau mobile.
function compressImage(file, maxSize = 1000, quality = 0.82) {
    return new Promise((resolve, reject) => {
        if (!file.type.startsWith('image/')) { reject(new Error('Ce fichier n\'est pas une image')); return; }
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error);
        reader.onload = () => {
            const img = new Image();
            img.onerror = () => reject(new Error('Image illisible'));
            img.onload = () => {
                const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
                const canvas = document.createElement('canvas');
                canvas.width = Math.round(img.width * scale);
                canvas.height = Math.round(img.height * scale);
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#ffffff';  // fond blanc pour les PNG transparents
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.src = reader.result;
        };
        reader.readAsDataURL(file);
    });
}

function todayIso() {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function formatDateFr(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
}

// Prix affiché d'un produit : le plus bas parmi ses variantes, sinon le prix de base
function productPriceRange(p) {
    const prices = (p.variants || []).map(v => Number(v.price)).filter(n => n > 0);
    if (prices.length === 0) return { min: p.basePrice, max: p.basePrice };
    return { min: Math.min(...prices), max: Math.max(...prices) };
}

// Photos d'un produit : les siennes, sinon celles de ses versions (une par version)
function productAllPhotos(p) {
    const own = p.photos || [];
    const fromVariants = (p.variants || []).map(v => v.photos?.[0]).filter(Boolean);
    return [...new Set([...own, ...fromVariants])];
}

function productPriceLabel(p) {
    const { min, max } = productPriceRange(p);
    return (min !== max ? 'dès ' : '') + formatNumber(min) + ' FCFA';
}

function generateSlug(text) {
    return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function debouncedUpdatePreview() {
    if (updateTimeout) clearTimeout(updateTimeout);
    updateTimeout = setTimeout(() => updatePreview(), 100);
}

// ============ CARROUSEL ============
// Les médias sont stockés dans shops.design (base64) : on limite leur nombre et leur poids
const MAX_CAROUSEL_MEDIA = 6;
const MAX_CAROUSEL_VIDEO_BYTES = 2 * 1024 * 1024;
function setupCarouselUpload() {
    const carouselInput = document.getElementById('carouselMedia');
    if (carouselInput) {
        carouselInput.addEventListener('change', async (e) => {
            const files = Array.from(e.target.files).slice(0, MAX_CAROUSEL_MEDIA - carouselMedia.length);
            e.target.value = '';
            if (!files.length) { alert(`Maximum ${MAX_CAROUSEL_MEDIA} images ou vidéos dans le carrousel`); return; }
            for (const file of files) {
                if (file.type.startsWith('image/')) {
                    // Bannière : 1600 px de large suffisent, même sur grand écran
                    const src = await compressImage(file, 1600, 0.8).catch(() => null);
                    if (src) carouselMedia.push({ type: 'image', src });
                } else if (file.type.startsWith('video/')) {
                    if (file.size > MAX_CAROUSEL_VIDEO_BYTES) {
                        alert(`La vidéo « ${file.name} » est trop lourde (${(file.size / 1048576).toFixed(1)} Mo). Maximum 2 Mo : raccourcissez-la ou utilisez une image.`);
                        continue;
                    }
                    const src = await new Promise(res => {
                        const r = new FileReader();
                        r.onload = () => res(r.result);
                        r.onerror = () => res(null);
                        r.readAsDataURL(file);
                    });
                    if (src) carouselMedia.push({ type: 'video', src });
                } else {
                    alert(`« ${file.name} » n'est ni une image ni une vidéo`);
                }
            }
            renderCarouselList();
            debouncedUpdatePreview();
        });
    }
}

function removeCarouselMedia(idx) {
    carouselMedia.splice(idx, 1);
    renderCarouselList();
    debouncedUpdatePreview();
}

function renderCarouselList() {
    const container = document.getElementById('carouselList');
    if (!container) return;
    
    if (carouselMedia.length === 0) {
        container.innerHTML = '<div style="color:var(--gray-500);font-size:12px;">Aucun média</div>';
        return;
    }
    
    container.innerHTML = carouselMedia.map((m, i) => `
        <div style="position:relative;width:60px;height:60px;border-radius:8px;overflow:hidden;border:1px solid var(--gray-200);">
            ${m.type === 'image' 
                ? `<img src="${m.src}" style="width:100%;height:100%;object-fit:cover;">` 
                : `<video src="${m.src}" muted playsinline style="width:100%;height:100%;object-fit:cover;"></video>`
            }
            <div onclick="window.removeCarouselMedia(${i})" 
                 style="position:absolute;top:2px;right:2px;background:var(--danger);color:white;width:18px;height:18px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;cursor:pointer;">
                ✕
            </div>
        </div>
    `).join('');
}

// ============ CATÉGORIES ============
function addCategory() {
    const name = prompt("Nom de la catégorie :");
    if (name && name.trim()) {
        categories.push({ id: Date.now(), name: name.trim() });
        renderCategories();
        debouncedUpdatePreview();
    }
}

function updateCategoryName(catId, newName) {
    const cat = categories.find(c => String(c.id) === String(catId));
    if (cat) cat.name = newName;
    debouncedUpdatePreview();
}

function removeCategory(id) {
    if (confirm("Supprimer cette catégorie ?")) {
        if (products.some(p => String(p.categoryId) === String(id))) {
            alert("Supprimez d'abord les produits de cette catégorie");
            return;
        }
        categories = categories.filter(c => String(c.id) !== String(id));
        renderCategories();
        debouncedUpdatePreview();
    }
}

function renderCategories() {
    const container = document.getElementById('categoriesContainer');
    if (!container) return;
    if (categories.length === 0) {
        container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--gray-500);">Aucune catégorie</div>';
        return;
    }
    container.innerHTML = categories.map(cat => `
        <div class="category-item">
            <div class="category-header">
                <input type="text" class="category-name-input" value="${escapeHtml(cat.name)}" 
                       onchange="window.updateCategoryName('${cat.id}', this.value)" style="flex:1;">
                <button class="btn-danger" onclick="window.removeCategory('${cat.id}')">Supprimer</button>
            </div>
            <div class="category-products">${products.filter(p => String(p.categoryId) === String(cat.id)).length} produit(s)</div>
        </div>
    `).join('');
}

// ============ LOGO ============
function setupLogoUpload() {
    const logoInput = document.getElementById('logoUpload');
    if (logoInput) {
        logoInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files[0]) {
                const reader = new FileReader();
                reader.onload = ev => {
                    tempLogo = ev.target.result;
                    const preview = document.getElementById('logoPreview');
                    if (preview) {
                        preview.innerHTML = `<img src="${ev.target.result}" style="width:100%;height:100%;object-fit:contain;">`;
                    }
                    debouncedUpdatePreview();
                };
                reader.readAsDataURL(e.target.files[0]);
            }
        });
    }
}

// ============ PRODUITS ============
function openAddProductModal(productId = null) {
    if (categories.length === 0) {
        alert("Créez d'abord une catégorie");
        return;
    }
    
    editingProductId = productId;
    
    tempDefaultVersion = '';
    if (!productId) {
        tempVariants = [];
        tempVariantOptions = [];
        tempProductPhotos = [];
    } else {
        const product = products.find(p => String(p.id) === String(productId));
        if (product) {
            tempVariants = (product.variants || []).map(v => ({ ...v, values: { ...v.values }, photos: [...(v.photos || [])] }));
            tempDefaultVersion = (product.variants || []).find(v => v.is_default)?.key
                || (product.variants || []).find(v => Number(v.price) === Number(product.basePrice))?.key || '';
            tempVariantOptions = (product.variantOptions || []).map(o => ({ name: o.name, values: [...o.values] }));
            tempProductPhotos = [...(product.photos || [])];
        }
    }
    
    renderProductForm();
    document.getElementById('modalTitle').innerText = productId ? 'Modifier le produit' : 'Ajouter un produit';
    document.getElementById('productModal').classList.add('active');
}

function renderProductForm() {
    const product = editingProductId ? products.find(p => String(p.id) === String(editingProductId)) : null;
    const form = document.getElementById('productForm');
    if (!form) return;
    
    const food = product?.food || null;
    const beauty = product?.beauty || null;
    const hasVariants = tempVariantOptions.length > 0;

    form.innerHTML = `
        <div class="form-group">
            <label>Nom du produit *</label>
            <input type="text" id="productName" value="${escapeHtml(product?.name || '')}" placeholder="Ex : iPhone 15, PlayStation 5, Gâteau au chocolat">
        </div>
        <div class="form-group">
            <label>Catégorie *</label>
            <select id="productCategory">
                ${categories.map(cat => `<option value="${cat.id}" ${String(product?.categoryId) === String(cat.id) ? 'selected' : ''}>${escapeHtml(cat.name)}</option>`).join('')}
            </select>
        </div>
        <div class="form-row">
            <div class="form-group" id="basePriceGroup" style="${hasVariants ? 'display:none;' : ''}">
                <label>Prix (FCFA) *</label>
                <input type="number" id="productBasePrice" min="0" value="${product?.basePrice || ''}">
            </div>
            <div class="form-group" id="defaultVersionGroup" style="${hasVariants ? '' : 'display:none;'}">
                <label>Prix affiché par défaut *</label>
                <select id="defaultVersion" onchange="window.setDefaultVersion(this.value)"></select>
                <small class="hint">C'est le prix d'une de tes versions : choisis laquelle le client voit en premier.</small>
            </div>
            <div class="form-group" id="productStockGroup" style="${hasVariants ? 'display:none;' : ''}">
                <label>Stock</label>
                <input type="number" id="productStock" min="0" value="${product?.stock || 0}">
            </div>
        </div>
        <div class="form-group">
            <label>Description</label>
            <textarea id="productDesc" rows="3">${escapeHtml(product?.description || '')}</textarea>
        </div>
        <div class="form-group">
            <label>Photos (max 5)</label>
            <div id="productPhotosContainer" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;"></div>
            <input type="file" id="productPhotoInput" accept="image/*" multiple style="margin-top:8px;">
        </div>

        <!-- ===== VARIANTES ===== -->
        <div class="form-section">
            <label class="toggle-line">
                <input type="checkbox" id="hasVariants" ${hasVariants ? 'checked' : ''} onchange="window.toggleVariants(this.checked)">
                <span><strong>Plusieurs versions</strong> — taille, couleur, capacité, modèle… avec des prix différents</span>
            </label>
            <div id="variantsSection" style="${hasVariants ? '' : 'display:none;'}">
                <p class="hint">Ex. iPhone : <em>Modèle</em> = 15, 15 Pro · <em>Capacité</em> = 128 Go, 256 Go · <em>Couleur</em> = Noir, Blanc. Séparez les valeurs par des virgules.</p>
                <div id="variantOptionsContainer"></div>
                <button type="button" class="btn-sm" id="addOptionBtn" onclick="window.addVariantOption()">+ Ajouter une option</button>
                <div id="variantCombosContainer" style="margin-top:12px;"></div>
            </div>
        </div>

        <!-- ===== ALIMENTAIRE ===== -->
        <div class="form-section">
            <label class="toggle-line">
                <input type="checkbox" id="isFood" ${food ? 'checked' : ''} onchange="window.toggleFood(this.checked)">
                <span><strong>Produit alimentaire</strong> — date de péremption, ingrédients, conservation</span>
            </label>
            <div id="foodSection" style="${food ? '' : 'display:none;'}">
                <div class="form-group">
                    <label>Ce produit est-il fait maison ? *</label>
                    <div class="radio-line">
                        <label><input type="radio" name="foodHomemade" value="no" ${!food?.homemade ? 'checked' : ''} onchange="window.toggleHomemade(false)"> Non, produit industriel / emballé</label>
                        <label><input type="radio" name="foodHomemade" value="yes" ${food?.homemade ? 'checked' : ''} onchange="window.toggleHomemade(true)"> Oui, fait maison</label>
                    </div>
                </div>
                <div id="foodIndustrial" style="${food?.homemade ? 'display:none;' : ''}">
                    <div class="form-row">
                        <div class="form-group">
                            <label>Date de péremption *</label>
                            <input type="date" id="foodExpiry" min="${todayIso()}" value="${escapeHtml(food?.expiry_date || '')}">
                        </div>
                        <div class="form-group">
                            <label>Type de date</label>
                            <select id="foodExpiryType">
                                <option value="dlc" ${food?.expiry_type !== 'ddm' ? 'selected' : ''}>À consommer jusqu'au (DLC)</option>
                                <option value="ddm" ${food?.expiry_type === 'ddm' ? 'selected' : ''}>De préférence avant (DDM)</option>
                            </select>
                        </div>
                    </div>
                </div>
                <div id="foodHomemadeFields" style="${food?.homemade ? '' : 'display:none;'}">
                    <div class="form-row">
                        <div class="form-group">
                            <label>Se conserve combien de jours ? *</label>
                            <input type="number" id="foodShelfLife" min="1" max="365" value="${food?.shelf_life_days || ''}" placeholder="Ex : 3">
                        </div>
                        <div class="form-group">
                            <label>&nbsp;</label>
                            <label class="toggle-line" style="margin:0;">
                                <input type="checkbox" id="foodMadeToOrder" ${food?.made_to_order ? 'checked' : ''}>
                                <span>Préparé à la commande</span>
                            </label>
                        </div>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Conservation</label>
                        <select id="foodStorage">
                            <option value="ambiant" ${!food?.storage || food?.storage === 'ambiant' ? 'selected' : ''}>Température ambiante</option>
                            <option value="frais" ${food?.storage === 'frais' ? 'selected' : ''}>Au frais (réfrigérateur)</option>
                            <option value="congele" ${food?.storage === 'congele' ? 'selected' : ''}>Congelé</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Poids / volume</label>
                        <input type="text" id="foodWeight" value="${escapeHtml(food?.weight || '')}" placeholder="Ex : 500 g, 1 L">
                    </div>
                </div>
                <div class="form-group">
                    <label>Origine</label>
                    <input type="text" id="foodOrigin" value="${escapeHtml(food?.origin || '')}" placeholder="Ex : Congo, Cameroun, France">
                </div>
                <div class="form-group">
                    <label>Ingrédients</label>
                    <textarea id="foodIngredients" rows="2" placeholder="Ex : farine, sucre, œufs, beurre">${escapeHtml(food?.ingredients || '')}</textarea>
                </div>
                <div class="form-group">
                    <label>Allergènes</label>
                    <input type="text" id="foodAllergens" value="${escapeHtml(food?.allergens || '')}" placeholder="Ex : gluten, arachides, lait">
                </div>
            </div>
        </div>

        <!-- ===== BEAUTÉ : caractéristiques seulement ===== -->
        <div class="form-section">
            <label class="toggle-line">
                <input type="checkbox" id="isBeauty" ${beauty ? 'checked' : ''} onchange="window.toggleBeauty(this.checked)">
                <span><strong>💄 Produit de beauté</strong></span>
            </label>
            <div id="beautySection" style="${beauty ? '' : 'display:none;'}">
                <p class="beauty-step">Type</p>
                <input type="hidden" id="beautyKind" value="${escapeHtml(beauty?.kind && BEAUTY_KINDS[beauty.kind] ? beauty.kind : 'visage')}">
                <div class="beauty-kinds" id="beautyKinds">
                    ${Object.entries(BEAUTY_KINDS).map(([k, b]) => `<button type="button" class="beauty-kind ${(beauty?.kind || 'visage') === k ? 'active' : ''}" data-kind="${k}" onclick="window.selectBeautyKind('${k}')"><span>${b.emoji}</span>${b.short}</button>`).join('')}
                </div>

                <div class="form-row" style="margin-top:12px;">
                    <div class="form-group">
                        <label>Marque</label>
                        <input type="text" id="beautyBrand" list="beautyBrands" value="${escapeHtml(beauty?.brand || '')}" placeholder="Ex : Nivea">
                        <datalist id="beautyBrands">${BEAUTY_BRANDS.map(x => `<option value="${escapeHtml(x)}">`).join('')}</datalist>
                    </div>
                    <div class="form-group">
                        <label>État</label>
                        <select id="beautyCondition">
                            <option value="new" ${beauty?.condition !== 'opened' ? 'selected' : ''}>Neuf, scellé</option>
                            <option value="opened" ${beauty?.condition === 'opened' ? 'selected' : ''}>Ouvert / testé</option>
                        </select>
                    </div>
                </div>

                <div class="beauty-versions">
                    <button type="button" class="btn-sm" id="beautyVersionsBtn" onclick="window.beautyVersions()"></button>
                    <span class="hint">une photo et un prix chacune</span>
                </div>
                <p class="hint" style="margin-top:10px;">Ingrédients, conseils, contenance… : écris-les dans la <strong>Description</strong>.</p>
            </div>
        </div>

        <button class="btn-primary" onclick="window.saveProduct()">${product ? 'Mettre à jour' : 'Ajouter'}</button>
    `;

    renderProductPhotos(tempProductPhotos);
    renderVariantOptions();
    renderVariantCombos();
    tempBeautyKeep = beauty || {};   // anciens champs (date, origine…) conservés tels quels
    renderBeautyVersionsHint();

    const photoInput = document.getElementById('productPhotoInput');
    if (photoInput) photoInput.addEventListener('change', handleProductPhotoUpload);
}

// ============ VARIANTES ============
const MAX_VARIANT_OPTIONS = 3;
const MAX_VARIANT_COMBOS = 100;
const OPTION_SUGGESTIONS = ['Couleur', 'Taille', 'Pointure', 'Capacité', 'Modèle', 'Version', 'Saveur', 'Contenance', 'Teinte', 'Parfum', 'Type de peau'];

function toggleVariants(on) {
    document.getElementById('variantsSection').style.display = on ? '' : 'none';
    document.getElementById('productStockGroup').style.display = on ? 'none' : '';
    document.getElementById('basePriceGroup').style.display = on ? 'none' : '';
    document.getElementById('defaultVersionGroup').style.display = on ? '' : 'none';
    if (on && tempVariantOptions.length === 0) addVariantOption();
    renderDefaultVersion();
}

// Version affichée par défaut : son prix devient le prix du produit (toujours un des prix x, y, z)
let tempDefaultVersion = '';

function defaultVersion() {
    const priced = tempVariants.filter(v => Number(v.price) > 0);
    return priced.find(v => v.key === tempDefaultVersion)
        || priced.slice().sort((a, b) => a.price - b.price)[0]
        || null;
}

function renderDefaultVersion() {
    const select = document.getElementById('defaultVersion');
    if (!select) return;
    const priced = tempVariants.filter(v => Number(v.price) > 0);
    const current = defaultVersion();
    select.innerHTML = priced.length
        ? priced.map(v => `<option value="${escapeHtml(v.key)}" ${current && v.key === current.key ? 'selected' : ''}>${escapeHtml(v.key)} — ${Number(v.price).toLocaleString('fr-FR')} FCFA</option>`).join('')
        : '<option value="">Saisis d\'abord le prix de tes versions</option>';
    select.disabled = !priced.length;
}

function setDefaultVersion(key) {
    tempDefaultVersion = key;
}

function addVariantOption() {
    if (tempVariantOptions.length >= MAX_VARIANT_OPTIONS) return;
    const used = tempVariantOptions.map(o => o.name);
    const name = OPTION_SUGGESTIONS.find(s => !used.includes(s)) || '';
    tempVariantOptions.push({ name, values: [] });
    renderVariantOptions();
    renderVariantCombos();
}

function removeVariantOption(idx) {
    tempVariantOptions.splice(idx, 1);
    renderVariantOptions();
    renderVariantCombos();
}

function updateVariantOptionName(idx, name) {
    tempVariantOptions[idx].name = name.trim();
    renderVariantCombos();
}

function updateVariantOptionValues(idx, text) {
    const seen = new Set();
    tempVariantOptions[idx].values = text.split(',').map(v => v.trim())
        .filter(v => v && !seen.has(v.toLowerCase()) && seen.add(v.toLowerCase()));
    renderVariantCombos();
}

function renderVariantOptions() {
    const container = document.getElementById('variantOptionsContainer');
    if (!container) return;
    container.innerHTML = `
        <datalist id="optionSuggestions">${OPTION_SUGGESTIONS.map(s => `<option value="${s}">`).join('')}</datalist>
        ${tempVariantOptions.map((o, i) => `
            <div class="variant-option-row">
                <input type="text" list="optionSuggestions" value="${escapeHtml(o.name)}" placeholder="Option (ex : Couleur)"
                       onchange="window.updateVariantOptionName(${i}, this.value)" style="flex:0 0 32%;">
                <input type="text" value="${escapeHtml(o.values.join(', '))}" placeholder="Valeurs : Noir, Blanc, Bleu"
                       onchange="window.updateVariantOptionValues(${i}, this.value)" style="flex:1;">
                <button type="button" class="btn-danger" onclick="window.removeVariantOption(${i})" title="Retirer cette option">✕</button>
            </div>`).join('')}`;
    const addBtn = document.getElementById('addOptionBtn');
    if (addBtn) addBtn.style.display = tempVariantOptions.length >= MAX_VARIANT_OPTIONS ? 'none' : '';
}

// Produit cartésien des valeurs : [{Couleur:'Noir', Capacité:'128 Go'}, ...]
function buildCombinations(options) {
    const valid = options.filter(o => o.name && o.values.length > 0);
    if (valid.length === 0) return [];
    return valid.reduce((acc, opt) =>
        acc.flatMap(combo => opt.values.map(v => ({ ...combo, [opt.name]: v }))), [{}]);
}

function comboKey(values) {
    return Object.values(values).join(' / ');
}

// Régénère les combinaisons en conservant prix et stock déjà saisis
function renderVariantCombos() {
    const container = document.getElementById('variantCombosContainer');
    if (!container) return;

    const combos = buildCombinations(tempVariantOptions);
    if (combos.length > MAX_VARIANT_COMBOS) {
        container.innerHTML = `<p class="hint" style="color:var(--danger);">Trop de combinaisons (${combos.length}). Maximum ${MAX_VARIANT_COMBOS} : réduisez le nombre de valeurs.</p>`;
        tempVariants = [];
        return;
    }

    const previous = new Map(tempVariants.map(v => [v.key, v]));
    tempVariants = combos.map(values => {
        const key = comboKey(values);
        const old = previous.get(key);
        return { key, values, price: old ? old.price : '', stock: old ? old.stock : 0, photos: old?.photos ? [...old.photos] : [] };
    });
    renderDefaultVersion();

    if (tempVariants.length === 0) {
        container.innerHTML = '<p class="hint">Renseignez au moins une option et ses valeurs pour créer les versions.</p>';
        return;
    }

    container.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <strong style="font-size:13px;">${tempVariants.length} version(s)</strong>
            <button type="button" class="btn-sm" onclick="window.applyBasePriceToVariants()">Même prix pour toutes</button>
        </div>
        <p class="hint">Chaque version doit avoir au moins une photo. Astuce : la photo d'une version est reprise automatiquement par les autres versions de même ${escapeHtml(photoOptionName() || 'option')} qui n'en ont pas encore.</p>
        <div class="variant-cards">
            ${tempVariants.map((v, i) => `
                <div class="variant-card ${v.photos.length ? '' : 'missing-photo'}">
                    <div class="variant-photos">
                        ${v.photos.map((src, j) => `
                            <div class="variant-thumb">
                                <img src="${src}" alt="">
                                <button type="button" onclick="window.removeVariantPhoto(${i}, ${j})" title="Retirer">✕</button>
                            </div>`).join('')}
                        ${v.photos.length < MAX_VARIANT_PHOTOS ? `
                            <label class="variant-photo-add" title="Ajouter une photo">
                                <i class="fas fa-camera"></i><span>${v.photos.length ? '+' : 'Photo *'}</span>
                                <input type="file" accept="image/*" multiple onchange="window.addVariantPhotos(${i}, this)">
                            </label>` : ''}
                    </div>
                    <div class="variant-fields">
                        <div class="variant-name">${escapeHtml(v.key)}</div>
                        <div class="variant-inputs">
                            <label>Prix (FCFA)<input type="number" min="0" value="${v.price}" onchange="window.updateVariantField(${i}, 'price', this.value)"></label>
                            <label>Stock<input type="number" min="0" value="${v.stock}" onchange="window.updateVariantField(${i}, 'stock', this.value)"></label>
                        </div>
                    </div>
                </div>`).join('')}
        </div>`;
}

// ============ PHOTOS DES VERSIONS ============
const MAX_VARIANT_PHOTOS = 3;

// Option qui détermine l'apparence (Couleur…) : sa photo vaut pour toutes les tailles
function photoOptionName() {
    const named = tempVariantOptions.filter(o => o.name && o.values.length);
    const visual = named.find(o => /coul|colo|motif|mod[eè]le|finition/i.test(o.name));
    return (visual || named[0])?.name || '';
}

async function addVariantPhotos(idx, input) {
    const variant = tempVariants[idx];
    if (!variant) return;
    const files = Array.from(input.files || []).slice(0, MAX_VARIANT_PHOTOS - variant.photos.length);
    input.value = '';
    const photos = (await Promise.all(files.map(f => compressImage(f).catch(() => null)))).filter(Boolean);
    if (!photos.length) { alert("Impossible de lire cette image"); return; }
    variant.photos.push(...photos);
    
    // Même couleur (ou même valeur de l'option visuelle) sans photo : on reprend celle-ci
    const opt = photoOptionName();
    if (opt) {
        tempVariants.forEach(other => {
            if (other !== variant && other.photos.length === 0 && other.values[opt] === variant.values[opt]) {
                other.photos = [variant.photos[0]];
            }
        });
    }
    renderVariantCombos();
}

function removeVariantPhoto(idx, photoIdx) {
    tempVariants[idx]?.photos.splice(photoIdx, 1);
    renderVariantCombos();
}

function updateVariantField(idx, field, value) {
    if (!tempVariants[idx]) return;
    tempVariants[idx][field] = field === 'price' ? (parseFloat(value) || '') : (parseInt(value) || 0);
    if (field === 'price') renderDefaultVersion();
}

function applyBasePriceToVariants() {
    const answer = prompt('Prix (FCFA) à appliquer à toutes les versions :', '');
    if (answer === null) return;
    const base = parseFloat(String(answer).replace(/\s/g, ''));
    if (isNaN(base) || base <= 0) { alert('Prix invalide'); return; }
    tempVariants.forEach(v => { v.price = base; });
    renderVariantCombos();
}

// ============ ALIMENTAIRE ============
function toggleFood(on) {
    document.getElementById('foodSection').style.display = on ? '' : 'none';
    // Un produit est soit alimentaire, soit beauté
    if (on && document.getElementById('isBeauty')?.checked) { document.getElementById('isBeauty').checked = false; toggleBeauty(false); }
}

// ============ BEAUTÉ ET SOINS ============
const SKIN_TYPES = ['Toutes les peaux', 'Peau sèche', 'Peau grasse', 'Peau sensible', 'Peau à taches'];
const HAIR_TYPES = ['Tous les cheveux', 'Crépus', 'Frisés / bouclés', 'Lisses', 'Locks'];
const BEAUTY_KINDS = {
    visage:     { emoji: '💆', short: 'Visage',     label: 'Soin du visage',  targets: SKIN_TYPES, title: '2. Pour quelle peau ?', option: 'Contenance', examples: 'Ex : 50 ml, 100 ml' },
    corps:      { emoji: '🧴', short: 'Corps',      label: 'Soin du corps',   targets: SKIN_TYPES, title: '2. Pour quelle peau ?', option: 'Contenance', examples: 'Ex : 200 ml, 400 ml' },
    cheveux:    { emoji: '💇', short: 'Cheveux',    label: 'Cheveux',         targets: HAIR_TYPES, title: '2. Pour quels cheveux ?', option: 'Contenance', examples: 'Ex : 250 ml, 500 ml' },
    maquillage: { emoji: '🎨', short: 'Maquillage', label: 'Maquillage',      targets: ['Peau claire', 'Peau mate', 'Peau foncée', 'Toutes'], title: '2. Pour quelle carnation ?', option: 'Teinte', examples: 'Ex : Caramel, Ébène' },
    levres:     { emoji: '💋', short: 'Lèvres',     label: 'Lèvres',          targets: ['Mat', 'Brillant', 'Longue tenue'], title: '2. Quel fini ?', option: 'Teinte', examples: 'Ex : Rouge, Nude, Bordeaux' },
    parfum:     { emoji: '🌸', short: 'Parfum',     label: 'Parfum',          targets: ['Femme', 'Homme', 'Mixte'], title: '2. Pour qui ?', option: 'Contenance', examples: 'Ex : 30 ml, 50 ml, 100 ml' },
    hygiene:    { emoji: '🧼', short: 'Hygiène',    label: 'Hygiène',         targets: ['Femme', 'Homme', 'Enfant', 'Tous'], title: '2. Pour qui ?', option: 'Parfum', examples: 'Ex : Coco, Karité' },
    ongles:     { emoji: '💅', short: 'Ongles',     label: 'Ongles',          targets: [], title: '', option: 'Couleur', examples: 'Ex : Rouge, Nude, Noir' },
    autre:      { emoji: '✨', short: 'Autre',      label: 'Beauté',          targets: [], title: '', option: 'Modèle', examples: 'Ex : Modèle A, Modèle B' }
};

let tempBeautyKeep = {};
const BEAUTY_BRANDS = ['Nivea', 'Dove', 'Vaseline', 'Garnier', "L'Oréal", 'Maybelline', 'Fenty Beauty', 'Black Opal', 'Iman', 'Sleek', 'Fair & White',
    'Carotone', 'Movate', 'Cantu', 'Shea Moisture', 'Dark and Lovely', 'ORS', 'Palmer\'s', 'CeraVe', 'The Ordinary', 'Nars', 'MAC', 'Dior', 'Chanel', 'Fait maison'];

function selectBeautyKind(k) {
    if (!BEAUTY_KINDS[k]) return;
    document.getElementById('beautyKind').value = k;
    document.querySelectorAll('#beautyKinds .beauty-kind').forEach(b => b.classList.toggle('active', b.dataset.kind === k));
    renderBeautyVersionsHint();
}

// Une version par teinte / contenance… : chacune a sa photo, son prix et son stock
function beautyVersions() {
    const kind = BEAUTY_KINDS[document.getElementById('beautyKind')?.value] || BEAUTY_KINDS.visage;
    const box = document.getElementById('hasVariants');
    if (box && !box.checked) { box.checked = true; toggleVariants(true); }
    const empty = tempVariantOptions.find(o => !o.values.length);
    if (!tempVariantOptions.some(o => o.name === kind.option)) {
        if (empty) empty.name = kind.option;
        else if (tempVariantOptions.length < MAX_VARIANT_OPTIONS) tempVariantOptions.push({ name: kind.option, values: [] });
    }
    renderVariantOptions();
    renderVariantCombos();
    const idx = tempVariantOptions.findIndex(o => o.name === kind.option);
    const input = document.querySelectorAll('.variant-option-row')[idx]?.querySelectorAll('input')[1];
    if (input) {
        input.placeholder = `${kind.examples} (séparées par des virgules)`;
        input.scrollIntoView({ behavior: 'smooth', block: 'center' });
        input.focus({ preventScroll: true });
    }
}

function renderBeautyVersionsHint() {
    const kind = BEAUTY_KINDS[document.getElementById('beautyKind')?.value] || BEAUTY_KINDS.visage;
    const btn = document.getElementById('beautyVersionsBtn');
    if (btn) btn.innerHTML = `<i class="fas fa-plus"></i> Ajouter des ${kind.option.toLowerCase()}s`;
}

function toggleBeauty(on) {
    document.getElementById('beautySection').style.display = on ? '' : 'none';
    if (on && document.getElementById('isFood')?.checked) { document.getElementById('isFood').checked = false; toggleFood(false); }
}

// Cases à cocher adaptées au type de produit (peau, cheveux, carnation…)
function renderBeautyTargets(selected) {
    const box = document.getElementById('beautyTargets');
    if (!box) return;
    const kind = BEAUTY_KINDS[document.getElementById('beautyKind')?.value] || BEAUTY_KINDS.visage;
    const keep = Array.isArray(selected) ? selected
        : Array.from(box.querySelectorAll('input:checked')).map(i => i.value);
    document.getElementById('beautyTargetsLabel').textContent = kind.title;
    document.getElementById('beautyTargetsLabel').style.display = kind.targets.length ? '' : 'none';
    box.style.display = kind.targets.length ? '' : 'none';
    box.innerHTML = kind.targets.map(t => `<label class="chip-check"><input type="checkbox" value="${escapeHtml(t)}" ${keep.includes(t) ? 'checked' : ''}><span>${escapeHtml(t)}</span></label>`).join('');
}

// Lit et valide la section beauté. Renvoie { beauty } ou { error }.
function readBeautyForm() {
    if (!document.getElementById('isBeauty')?.checked) return { beauty: null };
    const v = id => document.getElementById(id)?.value.trim() || '';
    const condition = v('beautyCondition') === 'opened' ? 'opened' : 'new';
    // Anciennes infos (ingrédients, conseils…) conservées telles quelles, plus saisies ici
    return { beauty: { ...tempBeautyKeep, kind: BEAUTY_KINDS[v('beautyKind')] ? v('beautyKind') : 'autre',
        brand: v('beautyBrand'), condition, authentic: condition === 'new' } };
}

function toggleHomemade(homemade) {
    document.getElementById('foodIndustrial').style.display = homemade ? 'none' : '';
    document.getElementById('foodHomemadeFields').style.display = homemade ? '' : 'none';
}

// Lit et valide la section alimentaire. Renvoie { food } ou { error }.
function readFoodForm() {
    if (!document.getElementById('isFood')?.checked) return { food: null };
    const v = id => document.getElementById(id)?.value.trim() || '';
    const homemade = document.querySelector('input[name="foodHomemade"]:checked')?.value === 'yes';
    const food = {
        homemade,
        storage: v('foodStorage') || 'ambiant',
        weight: v('foodWeight'),
        origin: v('foodOrigin'),
        ingredients: v('foodIngredients'),
        allergens: v('foodAllergens')
    };
    if (homemade) {
        const days = parseInt(v('foodShelfLife'));
        if (!days || days < 1 || days > 365) return { error: 'Indiquez combien de jours le produit fait maison se conserve (1 à 365).' };
        food.shelf_life_days = days;
        food.made_to_order = !!document.getElementById('foodMadeToOrder')?.checked;
    } else {
        const expiry = v('foodExpiry');
        if (!expiry) return { error: 'La date de péremption est obligatoire pour un produit alimentaire industriel.' };
        if (expiry < todayIso()) return { error: 'La date de péremption est déjà passée : ce produit ne peut pas être mis en vente.' };
        food.expiry_date = expiry;
        food.expiry_type = v('foodExpiryType') === 'ddm' ? 'ddm' : 'dlc';
    }
    return { food };
}

function foodSummary(food) {
    if (!food) return '';
    if (food.homemade) {
        return `Fait maison · se conserve ${food.shelf_life_days} j${food.made_to_order ? ' · préparé à la commande' : ''}`;
    }
    return `${food.expiry_type === 'ddm' ? 'DDM' : 'DLC'} ${formatDateFr(food.expiry_date)}`;
}

function renderProductPhotos(photos) {
    const container = document.getElementById('productPhotosContainer');
    if (!container) return;
    if (photos.length === 0) {
        container.innerHTML = '<div style="padding:10px;color:var(--gray-500);">Aucune photo</div>';
        return;
    }
    container.innerHTML = photos.map((photo, idx) => `
        <div style="position:relative;width:70px;height:70px;border-radius:8px;overflow:hidden;border:1px solid var(--gray-200);">
            <img src="${photo}" style="width:100%;height:100%;object-fit:cover;">
            <div onclick="window.removeProductPhoto(${idx})" 
                 style="position:absolute;top:2px;right:2px;background:var(--danger);color:white;width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;cursor:pointer;">
                ✕
            </div>
        </div>
    `).join('');
}

function handleProductPhotoUpload(e) {
    const files = Array.from(e.target.files);
    if (tempProductPhotos.length + files.length > 5) { alert("Maximum 5 photos"); return; }
    e.target.value = '';
    Promise.all(files.map(f => compressImage(f).catch(() => null))).then(results => {
        results.filter(Boolean).forEach(src => tempProductPhotos.push(src));
        renderProductPhotos(tempProductPhotos);
    });
}

function removeProductPhoto(idx) {
    tempProductPhotos.splice(idx, 1);
    renderProductPhotos(tempProductPhotos);
}

function saveProduct() {
    const name = document.getElementById('productName').value.trim();
    const categoryValue = document.getElementById('productCategory').value;
    const categoryId = categories.find(c => String(c.id) === categoryValue)?.id;
    const basePrice = parseFloat(document.getElementById('productBasePrice').value);
    const stock = parseInt(document.getElementById('productStock').value);
    const description = document.getElementById('productDesc').value;
    
    const withVariants = document.getElementById('hasVariants')?.checked;

    if (!name) { alert("Nom requis"); return; }
    if (!categoryId) { alert("Catégorie requise"); return; }

    let variants = [];
    let variantOptions = [];
    if (withVariants) {
        variantOptions = tempVariantOptions.filter(o => o.name && o.values.length > 0);
        const names = variantOptions.map(o => o.name.toLowerCase());
        if (new Set(names).size !== names.length) { alert("Deux options portent le même nom"); return; }
        if (tempVariants.length === 0) { alert("Ajoutez au moins une option avec ses valeurs, ou décochez « Plusieurs versions »"); return; }
        const missing = tempVariants.filter(v => !(Number(v.price) > 0));
        if (missing.length) { alert(`Prix manquant pour : ${missing.slice(0, 3).map(v => v.key).join(', ')}${missing.length > 3 ? '…' : ''}`); return; }
        const noPhoto = tempVariants.filter(v => !v.photos?.length);
        if (noPhoto.length) { alert(`Ajoutez au moins une photo pour : ${noPhoto.slice(0, 3).map(v => v.key).join(', ')}${noPhoto.length > 3 ? '…' : ''}`); return; }
        const def = defaultVersion();
        variants = tempVariants.map(v => ({ key: v.key, values: v.values, price: Number(v.price), stock: Number(v.stock) || 0, photos: v.photos,
            ...(def && v.key === def.key ? { is_default: true } : {}) }));
    } else if (isNaN(basePrice) || basePrice <= 0) {
        alert("Prix valide requis"); return;
    }

    const { food, error: foodError } = readFoodForm();
    if (foodError) { alert(foodError); return; }
    const { beauty, error: beautyError } = readBeautyForm();
    if (beautyError) { alert(beautyError); return; }

    const productData = {
        id: editingProductId || Date.now(),
        name, categoryId, description,
        // Avec variantes : prix = celui de la version par défaut (un des prix des versions), stock = somme des versions
        basePrice: variants.length ? (variants.find(v => v.is_default) || variants[0]).price : basePrice,
        stock: variants.length ? variants.reduce((s, v) => s + v.stock, 0) : (stock || 0),
        photos: tempProductPhotos,
        variantOptions,
        variants,
        food,
        beauty,
        hadBeauty: !!(editingProductId && products.find(x => String(x.id) === String(editingProductId))?.hadBeauty)
    };
    
    if (editingProductId) {
        const index = products.findIndex(p => String(p.id) === String(editingProductId));
        if (index !== -1) products[index] = productData;
    } else {
        products.push(productData);
    }
    
    const wasEditing = !!editingProductId;
    closeProductModal();
    renderProductsList();
    renderCategories();
    debouncedUpdatePreview();
    alert(wasEditing ? "Produit modifié" : "Produit ajouté");
}

function renderProductsList() {
    const container = document.getElementById('productsContainer');
    if (!container) return;
    if (products.length === 0) {
        container.innerHTML = '<div style="text-align:center;padding:20px;">Aucun produit</div>';
        return;
    }
    container.innerHTML = products.map(p => {
        const category = categories.find(c => String(c.id) === String(p.categoryId));
        const hasVariants = (p.variants || []).length > 0;
        // Avec variantes, prix et stock se modifient version par version (bouton Modifier)
        const priceStock = hasVariants ? `
                    <div class="product-variants-summary">${productPriceLabel(p)}<br><small>${p.stock} en stock</small></div>` : `
                    <input type="number" class="product-price-input" value="${p.basePrice}"
                           onchange="window.updateProductField('${p.id}', 'price', parseFloat(this.value))" placeholder="Prix">
                    <input type="number" class="product-stock-input" value="${p.stock}"
                           onchange="window.updateProductField('${p.id}', 'stock', parseInt(this.value))" placeholder="Stock">`;
        return `
            <div class="product-item">
                <div class="product-header">
                    <input type="text" class="product-name-input" value="${escapeHtml(p.name)}"
                           onchange="window.updateProductField('${p.id}', 'name', this.value)" placeholder="Nom">
                    ${priceStock}
                    <div>
                        <button class="btn-sm" onclick="window.editProduct('${p.id}')">Modifier</button>
                        <button class="btn-sm" style="background:#fee2e2;" onclick="window.deleteProduct('${p.id}')">Supprimer</button>
                    </div>
                </div>
                <div style="font-size:12px; color:var(--gray-500);">
                    Catégorie: ${escapeHtml(category?.name || 'Sans catégorie')} | ${productAllPhotos(p).length} photo(s)
                    ${hasVariants ? ` | ${p.variants.length} version(s) : ${escapeHtml((p.variantOptions || []).map(o => o.name).join(', '))}` : ''}
                </div>
                ${p.food ? `<div class="food-badge">🍽️ ${escapeHtml(foodSummary(p.food))}</div>` : ''}
                ${p.beauty ? `<div class="food-badge">💄 ${escapeHtml([BEAUTY_KINDS[p.beauty.kind]?.label, p.beauty.volume].filter(Boolean).join(' · '))}</div>` : ''}
                ${productAllPhotos(p).length > 0 ? `
                    <div style="display:flex;gap:8px;margin-top:8px;">
                        ${productAllPhotos(p).slice(0, 6).map(photo => `
                            <div style="width:50px;height:50px;border-radius:8px;overflow:hidden;border:1px solid var(--gray-200);">
                                <img src="${photo}" style="width:100%;height:100%;object-fit:cover;">
                            </div>
                        `).join('')}
                    </div>
                ` : ''}
            </div>
        `;
    }).join('');
}

function updateProductField(productId, field, value) {
    const product = products.find(p => String(p.id) === String(productId));
    if (product) {
        if (field === 'name') product.name = value;
        if (field === 'price') product.basePrice = value;
        if (field === 'stock') product.stock = value;
        renderProductsList();
        debouncedUpdatePreview();
    }
}

function editProduct(id) { openAddProductModal(id); }

function deleteProduct(id) {
    if (confirm("Supprimer ce produit ?")) {
        products = products.filter(p => String(p.id) !== String(id));
        renderProductsList();
        renderCategories();
        debouncedUpdatePreview();
    }
}

function closeProductModal() {
    document.getElementById('productModal').classList.remove('active');
    tempProductPhotos = [];
    tempVariants = [];
    tempVariantOptions = [];
    editingProductId = null;
}

// ============ APERÇU EN TEMPS RÉEL ============
function updatePreview() {
    const preview = document.getElementById('livePreview');
    if (!preview) return;
    
    const shopName = document.getElementById('shopNameInput')?.value || 'Ma boutique';
    const desc = document.getElementById('shopDescInput')?.value || '';
    const city = document.getElementById('shopCity')?.value || 'Brazzaville';
    const quartier = document.getElementById('shopQuartier')?.value || '';
    const primaryColor = document.getElementById('primaryColor')?.value || '#1e40af';
    const buttonColor = document.getElementById('buttonColor')?.value || '#1e40af';
    const bgColor = document.getElementById('bgColor')?.value || '#ffffff';
    const headerTextColor = document.getElementById('headerTextColor')?.value || '#ffffff';
    const productTextColor = document.getElementById('productTextColor')?.value || '#1e293b';
    const showSearch = document.getElementById('showSearchBar')?.checked || false;
    
    const menuPosition = designConfig.menuPosition;
    const isVertical = menuPosition === 'vertical-left' || menuPosition === 'vertical-right';
    const floatDir = menuPosition === 'vertical-left' ? 'left' : 'right';
    
    // MENU
    let menuHtml = '';
    if (categories.length > 0) {
        if (isVertical) {
            menuHtml = `
                <div style="background:${designConfig.menuBg};color:${designConfig.menuText};
                            border-radius:${designConfig.menuRadius}px;float:${floatDir};
                            width:160px;margin-${floatDir === 'left' ? 'right' : 'left'}:16px;padding:12px;">
                    ${categories.map(cat => `<div style="padding:6px 0;font-size:13px;">${escapeHtml(cat.name)}</div>`).join('')}
                </div>`;
        } else {
            menuHtml = `
                <div style="background:${designConfig.menuBg};color:${designConfig.menuText};
                            border-radius:${designConfig.menuRadius}px;padding:10px 16px;
                            display:flex;gap:16px;flex-wrap:wrap;">
                    ${categories.map(cat => `<span style="font-size:13px;">${escapeHtml(cat.name)}</span>`).join('')}
                </div>`;
        }
    }
    
    const contentMargin = isVertical 
        ? (floatDir === 'left' ? 'margin-left:176px;' : 'margin-right:176px;')
        : '';
    
    const productsStyle = designConfig.layout === 'grid'
        ? `display:grid;grid-template-columns:repeat(auto-fill,minmax(${designConfig.prodWidth}px,1fr));gap:${designConfig.prodGap}px;`
        : `display:flex;flex-direction:column;gap:${designConfig.prodGap}px;`;
    
    // CARROUSEL
    let carouselHtml = '';
    if (carouselMedia.length > 0) {
        carouselHtml = `
            <div style="height:${designConfig.carouselHeight}px;border-radius:${designConfig.carouselRadius}px;overflow:hidden;margin:12px 16px;position:relative;">
                <div id="previewCarousel" style="height:100%;position:relative;">
                    ${carouselMedia.map((m, i) => `
                        ${m.type === 'image' 
                            ? `<img src="${m.src}" class="carousel-slide" style="width:100%;height:100%;object-fit:cover;display:${i === 0 ? 'block' : 'none'};position:absolute;top:0;left:0;">`
                            : `<video src="${m.src}" class="carousel-slide" muted autoplay loop playsinline style="width:100%;height:100%;object-fit:cover;display:${i === 0 ? 'block' : 'none'};position:absolute;top:0;left:0;"></video>`
                        }
                    `).join('')}
                </div>
            </div>
        `;
    }
    
    preview.innerHTML = `
        <div style="background:${bgColor};border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.05);">
            <div style="background:linear-gradient(135deg,${primaryColor},${primaryColor}aa);padding:20px;color:${headerTextColor};">
                <div style="display:flex;align-items:center;gap:12px;">
                    <div style="width:55px;height:55px;background:white;border-radius:12px;display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;">
                        ${tempLogo ? `<img src="${tempLogo}" style="width:100%;height:100%;object-fit:contain;">` : '<i class="fas fa-store" style="font-size:24px;color:#1e40af;"></i>'}
                    </div>
                    <div style="flex:1;">
                        <h3 style="font-size:16px;margin:0;">${escapeHtml(shopName)}</h3>
                        <p style="font-size:11px;margin:4px 0;opacity:0.9;">${escapeHtml(desc)}</p>
                        <div style="font-size:10px;"><i class="fas fa-map-marker-alt"></i> ${escapeHtml(city)} ${escapeHtml(quartier)}</div>
                    </div>
                </div>
            </div>
            
            ${showSearch ? `
                <div style="padding:12px 16px;background:${bgColor};border-bottom:1px solid #e2e8f0;">
                    <div style="display:flex;background:#f1f5f9;border-radius:20px;padding:8px 14px;align-items:center;gap:8px;">
                        <input type="text" placeholder="Rechercher un produit..." style="flex:1;border:none;background:transparent;outline:none;font-size:13px;" disabled>
                        <i class="fas fa-search" style="color:${primaryColor};font-size:14px;"></i>
                    </div>
                </div>
            ` : ''}
            
            ${carouselHtml}
            
            ${menuHtml}
            
            <div style="padding:16px;${contentMargin}">
                <h4 style="font-size:14px;margin-bottom:12px;">Produits (${products.length})</h4>
                ${products.length > 0 ? `
                    <div style="${productsStyle}">
                        ${products.slice(0, 6).map(p => `
                            <div style="background:white;border-radius:${designConfig.prodRadius}px;border:1px solid #e2e8f0;overflow:hidden;
                                        ${designConfig.layout === 'list' ? 'display:flex;gap:12px;' : ''}">
                                <div style="height:${designConfig.layout === 'list' ? '80px' : designConfig.prodImgHeight + 'px'};
                                            ${designConfig.layout === 'list' ? 'width:80px;' : ''}
                                            background:#f1f5f9;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                                    ${productAllPhotos(p)[0] ? `<img src="${productAllPhotos(p)[0]}" style="width:100%;height:100%;object-fit:cover;">` : '<i class="fas fa-image" style="font-size:32px;color:#cbd5e1;"></i>'}
                                </div>
                                <div style="padding:12px;flex:1;">
                                    <div style="font-weight:600;font-size:14px;color:${productTextColor};margin-bottom:4px;">${escapeHtml(p.name)}</div>
                                    <div style="font-weight:700;color:${primaryColor};font-size:14px;">${productPriceLabel(p)}</div>
                                    <button style="background:${buttonColor};color:white;border:none;padding:8px;border-radius:30px;width:100%;cursor:pointer;font-size:12px;font-weight:500;margin-top:8px;">
                                        Ajouter
                                    </button>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                ` : `
                    <div style="text-align:center;padding:40px;color:#94a3b8;">
                        <i class="fas fa-box-open" style="font-size:32px;margin-bottom:8px;"></i>
                        <p>Aucun produit pour l'instant</p>
                    </div>
                `}
            </div>
        </div>
    `;
}

// ============ DESIGN ============
function buildDesignPayload() {
    const v = id => document.getElementById(id)?.value;
    return {
        menu_position: designConfig.menuPosition,
        menu_bg: designConfig.menuBg,
        menu_text: designConfig.menuText,
        menu_radius: designConfig.menuRadius,
        carousel_height: designConfig.carouselHeight,
        carousel_radius: designConfig.carouselRadius,
        carousel_speed: designConfig.carouselSpeed,
        carousel_media: carouselMedia.map(m => ({ type: m.type === 'video' ? 'video' : 'image', src: m.src })),
        prod_width: designConfig.prodWidth,
        prod_img_height: designConfig.prodImgHeight,
        prod_radius: designConfig.prodRadius,
        prod_gap: designConfig.prodGap,
        layout: designConfig.layout,
        primary_color: v('primaryColor'),
        button_color: v('buttonColor'),
        background_color: v('bgColor'),
        header_text_color: v('headerTextColor'),
        product_text_color: v('productTextColor')
    };
}
 
// Recharge un design enregistré dans le formulaire (modification d'une boutique)
function applyDesign(d, showSearchBar) {
    d = d || {};
    const num = (x, def) => (Number.isFinite(Number(x)) ? Number(x) : def);
    designConfig.menuPosition = ['horizontal', 'vertical-left', 'vertical-right'].includes(d.menu_position) ? d.menu_position : 'horizontal';
    designConfig.menuBg = d.menu_bg || designConfig.menuBg;
    designConfig.menuText = d.menu_text || designConfig.menuText;
    designConfig.menuRadius = num(d.menu_radius, designConfig.menuRadius);
    designConfig.carouselHeight = num(d.carousel_height, designConfig.carouselHeight);
    designConfig.carouselRadius = num(d.carousel_radius, designConfig.carouselRadius);
    designConfig.carouselSpeed = num(d.carousel_speed, designConfig.carouselSpeed);
    designConfig.prodWidth = num(d.prod_width, designConfig.prodWidth);
    designConfig.prodImgHeight = num(d.prod_img_height, designConfig.prodImgHeight);
    designConfig.prodRadius = num(d.prod_radius, designConfig.prodRadius);
    designConfig.prodGap = num(d.prod_gap, designConfig.prodGap);
    designConfig.layout = d.layout === 'list' ? 'list' : 'grid';
    carouselMedia = Array.isArray(d.carousel_media) ? d.carousel_media.filter(m => m && m.src) : [];
 
    const set = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };
    set('primaryColor', d.primary_color);
    set('buttonColor', d.button_color);
    set('bgColor', d.background_color);
    set('headerTextColor', d.header_text_color);
    set('productTextColor', d.product_text_color);
    set('menuBgColor', designConfig.menuBg);
    set('menuTextColor', designConfig.menuText);
    const sliders = { menuRadius: 'menuRadius', carouselHeight: 'carouselHeight', carouselRadius: 'carouselRadius',
                      prodWidth: 'prodWidth', prodImgHeight: 'prodImgHeight', prodRadius: 'prodRadius', prodGap: 'prodGap' };
    Object.entries(sliders).forEach(([id, key]) => {
        const el = document.getElementById(id);
        if (el) el.value = designConfig[key];
        const label = document.getElementById(id + 'Val');
        if (label) label.innerText = designConfig[key];
    });
    const search = document.getElementById('showSearchBar');
    if (search) search.checked = !!showSearchBar;
    markSelectedCards();
    renderCarouselList();
}
 
function markSelectedCards() {
    document.querySelectorAll('.menu-pos-card').forEach(c => c.classList.toggle('selected', c.dataset.pos === designConfig.menuPosition));
    document.querySelectorAll('.speed-card').forEach(c => c.classList.toggle('selected', Number(c.dataset.speed) === designConfig.carouselSpeed));
    document.querySelectorAll('.layout-card').forEach(c => c.classList.toggle('selected', c.dataset.layout === designConfig.layout));
}
 
// ============ NOM UNIQUE ============
// true = disponible, false = déjà pris (sans tenir compte des majuscules ni des espaces)
async function isShopNameAvailable(name, excludeId = null) {
    const { data, error } = await window.supabase.rpc('shop_name_available', { shop_name: name, exclude_shop: excludeId });
    if (!error) return data !== false;
    // Fonction absente (migration non exécutée) : vérification directe
    const pattern = name.trim().replace(/[\\%_]/g, c => '\\' + c);
    const { data: rows } = await window.supabase.from('shops').select('id, name, archived_at').ilike('name', pattern).limit(20);
    return !(rows || []).some(r => !r.archived_at && String(r.id) !== String(excludeId)
        && r.name.trim().toLowerCase() === name.trim().toLowerCase());
}
 
function nameTakenMessage(name) {
    return `Le nom « ${name} » est déjà utilisé par une autre boutique. Choisis un autre nom (ex. ajoute ta ville ou ton quartier).`;
}
 
function isDuplicateNameError(error) {
    return error && (error.code === '23505' || /shops_name_unique/i.test(error.message || ''));
}
 
// ============ PUBLICATION ============
async function publishShopNow() {
    console.log('🚀 Publication...');
    
    const name = document.getElementById('shopNameInput').value.trim();
    if (!name) { alert("Nom de boutique requis"); return; }
    if (categories.length === 0) { alert("Créez au moins une catégorie"); return; }
    if (products.length === 0) { alert("Ajoutez au moins un produit"); return; }
    
    const { data: { user }, error: userError } = await window.supabase.auth.getUser();
    if (userError || !user) { alert("Connectez-vous"); return; }
    if (!(await isShopNameAvailable(name))) { alert(nameTakenMessage(name)); document.getElementById('shopNameInput').focus(); return; }
    
    // ============ VÉRIFIER SI UNE BOUTIQUE EXISTE DÉJÀ ============
    const { data: existingShops } = await window.supabase
        .from('shops')
        .select('id, name')
        .eq('owner_id', user.id);
    
    if (existingShops && existingShops.length > 0) {
        const confirmMsg = `⚠️ Vous avez déjà ${existingShops.length} boutique(s) :\n\n` +
            existingShops.map(s => `• ${s.name}`).join('\n') +
            `\n\nVoulez-vous créer une NOUVELLE boutique "${name}" ?`;
        
        if (!confirm(confirmMsg)) {
            return;
        }
    }
    // =============================================================
    
    const shopData = {
        owner_id: user.id,
        name: name,
        slug: generateSlug(name) + '-' + Date.now(),
        description: document.getElementById('shopDescInput').value || '',
        logo_url: tempLogo || '',
        city: document.getElementById('shopCity').value || 'Brazzaville',
        district: document.getElementById('shopQuartier').value || '',
        address: document.getElementById('shopAddress')?.value || '',
        country: 'Congo-Brazzaville',
        rating: 0,
        total_ratings: 0,
        total_sales: 0,
        is_verified: false,
        has_physical_store: false,
        is_active: true,
        show_search_bar: document.getElementById('showSearchBar')?.checked || false,
        design: buildDesignPayload()
    };
    
    try {
        const { data: insertedShop, error: shopError } = await window.supabase
            .from('shops').insert([shopData]).select().single();
        
        if (shopError) {
            console.error('❌', shopError);
            alert(isDuplicateNameError(shopError) ? nameTakenMessage(name) : 'Erreur: ' + shopError.message);
            return;
        }
        
        console.log('✅ Boutique créée:', insertedShop.id);
        
        // Catégories : on récupère les identifiants créés pour y rattacher les produits
        const categoryIdMap = new Map();
        if (categories.length > 0) {
            const categoriesData = categories.map(cat => ({
                shop_id: insertedShop.id,
                name: cat.name
            }));
            const { data: insertedCats, error: catError } = await window.supabase
                .from('categories').insert(categoriesData).select('id, name');
            if (catError) {
                console.error('❌ Catégories:', catError);
                alert(`⚠️ La boutique "${name}" est créée, mais ses catégories n'ont pas pu être enregistrées.\n\nDétail : ${catError.message}\n\nOuvre « Gérer » → « Modifier » pour les ajouter de nouveau.`);
            } else {
                // PostgREST renvoie les lignes dans l'ordre d'insertion
                categories.forEach((cat, i) => {
                    if (insertedCats?.[i]) categoryIdMap.set(String(cat.id), insertedCats[i].id);
                });
                console.log('✅ Catégories créées');
            }
        }

        // Produits
        if (products.length > 0) {
            const productsData = products.map(p => ({
                ...productRow(p, insertedShop.id, categoryIdMap.get(String(p.categoryId))),
                slug: generateSlug(p.name) + '-' + Date.now() + '-' + Math.random().toString(36).substring(7)
            }));

            const { error: prodError } = await window.supabase
                .from('products').insert(productsData);

            if (prodError) {
                console.error('❌ Produits:', prodError);
                const hint = /variants|food_info|column/i.test(prodError.message || '')
                    ? "\n\nLa base de données n'a pas encore les colonnes pour les versions et les infos alimentaires (migration SQL à exécuter)."
                    : '';
                alert(`⚠️ La boutique "${name}" est créée, mais ses produits n'ont pas pu être enregistrés.${hint}\n\nDétail : ${prodError.message}`);
                window.location.href = 'vendor-dashboard.html';
                return;
            }
            console.log('✅ Produits créés:', productsData.length);
        }
        
        alert(`✅ Boutique "${name}" créée avec succès !`);
        window.location.href = 'vendor-dashboard.html';
        
    } catch (error) {
        console.error('❌', error);
        alert('Erreur lors de la création');
    }
}

// ============ MISE À JOUR ============
async function updateShopNow() {
    if (!editingShopId) { alert("Erreur"); return; }
    const name = document.getElementById('shopNameInput').value.trim();
    if (!name) { alert("Nom requis"); return; }
    
    const { data: { user } } = await window.supabase.auth.getUser();
    if (!user) { alert("Connectez-vous"); return; }
    if (!(await isShopNameAvailable(name, editingShopId))) { alert(nameTakenMessage(name)); document.getElementById('shopNameInput').focus(); return; }
    
    const updates = {
        name: name,
        description: document.getElementById('shopDescInput').value || '',
        logo_url: tempLogo || '',
        city: document.getElementById('shopCity').value || 'Brazzaville',
        district: document.getElementById('shopQuartier').value || '',
        address: document.getElementById('shopAddress')?.value || '',
        show_search_bar: document.getElementById('showSearchBar')?.checked || false,
        design: buildDesignPayload()
    };
    
    const { error } = await window.supabase
        .from('shops').update(updates).eq('id', editingShopId).eq('owner_id', user.id);
    
    if (error) { alert(isDuplicateNameError(error) ? nameTakenMessage(name) : 'Erreur: ' + error.message); return; }

    // Catégories et produits : ajoutés, modifiés ou retirés depuis la création
    const syncError = await syncCatalog(editingShopId);
    if (syncError) {
        alert(`⚠️ La boutique est mise à jour, mais pas ses catégories ou produits.\n\nDétail : ${syncError}`
            + (/policy|permission|beauty_info|column/i.test(syncError) ? '\n\n(Migration SQL 20261023_products_beauty.sql à exécuter dans Supabase.)' : ''));
        return;
    }

    alert(`✅ Boutique mise à jour !`);
    window.location.href = 'vendor-dashboard.html';
}

const isUuid = v => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v));

// Ligne « products » à partir d'un produit du formulaire
function productRow(p, shopId, categoryId) {
    return {
        shop_id: shopId,
        category_id: categoryId || null,
        name: p.name,
        description: p.description || '',
        price: p.basePrice || p.price || 0,
        stock: p.stock || 0,
        product_type: p.food ? 'food' : 'standard',
        photos: p.photos || [],
        variants: { options: p.variantOptions || [], items: p.variants || [] },
        food_info: p.food || null,
        // beauty_info n'est envoyé que s'il y a quelque chose à écrire (ou à effacer)
        ...(p.beauty || p.hadBeauty ? { beauty_info: p.beauty || null } : {})
    };
}

// Enregistre l'état du formulaire (catégories + produits) pour une boutique existante.
// Renvoie un message d'erreur, ou null si tout est enregistré.
async function syncCatalog(shopId) {
    const db = window.supabase;
    const [{ data: dbCats, error: e1 }, { data: dbProds, error: e2 }] = await Promise.all([
        db.from('categories').select('id, name').eq('shop_id', shopId),
        db.from('products').select('id').eq('shop_id', shopId)
    ]);
    if (e1 || e2) return (e1 || e2).message;

    // 1. Catégories : nouvelles → insérées, renommées → mises à jour
    const known = new Map((dbCats || []).map(c => [String(c.id), c]));
    const catMap = new Map();
    for (const cat of categories) {
        const name = String(cat.name || '').trim() || 'Sans nom';
        const existing = isUuid(cat.id) ? known.get(String(cat.id)) : null;
        if (existing) {
            if (existing.name !== name) {
                const { error } = await db.from('categories').update({ name }).eq('id', existing.id).eq('shop_id', shopId);
                if (error) return error.message;
            }
            catMap.set(String(cat.id), existing.id);
        } else {
            const { data, error } = await db.from('categories').insert({ shop_id: shopId, name }).select('id').single();
            if (error) return error.message;
            catMap.set(String(cat.id), data.id);
            cat.id = data.id;
        }
    }

    // 2. Produits : nouveaux → insérés, existants → mis à jour
    const dbProdIds = new Set((dbProds || []).map(x => String(x.id)));
    for (const prod of products) {
        const row = productRow(prod, shopId, catMap.get(String(prod.categoryId)));
        if (isUuid(prod.id) && dbProdIds.has(String(prod.id))) {
            const { error } = await db.from('products').update(row).eq('id', prod.id).eq('shop_id', shopId);
            if (error) return error.message;
        } else {
            row.slug = generateSlug(prod.name) + '-' + Date.now() + '-' + Math.random().toString(36).substring(7);
            const { data, error } = await db.from('products').insert(row).select('id').single();
            if (error) return error.message;
            prod.id = data.id;
        }
    }

    // 3. Produits retirés : supprimés (ou masqués s'ils figurent dans d'anciennes commandes)
    const keepProds = new Set(products.map(x => String(x.id)));
    for (const id of dbProdIds) {
        if (keepProds.has(id)) continue;
        const { error } = await db.from('products').delete().eq('id', id).eq('shop_id', shopId);
        if (error) {
            const { error: e } = await db.from('products').update({ is_active: false, stock: 0 }).eq('id', id).eq('shop_id', shopId);
            if (e) return error.message;
        }
    }

    // 4. Catégories retirées
    const keepCats = new Set([...catMap.values()].map(String));
    for (const c of dbCats || []) {
        if (keepCats.has(String(c.id))) continue;
        const { error } = await db.from('categories').delete().eq('id', c.id).eq('shop_id', shopId);
        if (error) return error.message;
    }
    return null;
}

// ============ CHARGEMENT ============
async function loadShopForEditing(shopId) {
    const { data: { user } } = await window.supabase.auth.getUser();
    if (!user) { return false; }
    
    const { data: shop } = await window.supabase
        .from('shops').select('*').eq('id', shopId).eq('owner_id', user.id).single();
    
    if (!shop) { alert("Boutique non trouvée"); return false; }
    
    editingShopId = shop.id;
    document.getElementById('shopNameInput').value = shop.name || '';
    document.getElementById('shopDescInput').value = shop.description || '';
    document.getElementById('shopCity').value = shop.city || '';
    document.getElementById('shopQuartier').value = shop.district || '';
    const addressInput = document.getElementById('shopAddress');
    if (addressInput) addressInput.value = shop.address || '';
    applyDesign(shop.design, shop.show_search_bar);
    
    if (shop.logo_url) {
        tempLogo = shop.logo_url;
        document.getElementById('logoPreview').innerHTML = `<img src="${shop.logo_url}" style="width:100%;height:100%;object-fit:contain;">`;
    }
    
    const { data: cats } = await window.supabase.from('categories').select('*').eq('shop_id', shopId);
    categories = (cats || []).map(c => ({ id: c.id, name: c.name }));
    
    const { data: prods } = await window.supabase.from('products').select('*').eq('shop_id', shopId);
    products = (prods || []).map(p => ({
        id: p.id, name: p.name, categoryId: p.category_id,
        basePrice: p.price, stock: p.stock, description: p.description,
        photos: p.photos || [],
        variantOptions: p.variants?.options || [],
        variants: p.variants?.items || [],
        food: p.food_info || null,
        beauty: p.beauty_info || null,
        hadBeauty: !!p.beauty_info
    }));
    
    document.getElementById('pageTitle').innerText = `Modification : ${shop.name}`;
    document.getElementById('publishBtn').style.display = 'none';
    document.getElementById('updateBtn').style.display = 'block';
    
    renderCategories();
    renderProductsList();
    debouncedUpdatePreview();
    return true;
}

// ============ ÉCOUTEURS ============
function setupEventListeners() {
    const inputs = ['primaryColor', 'buttonColor', 'bgColor', 'headerTextColor', 'productTextColor',
                    'shopNameInput', 'shopDescInput', 'shopCity', 'shopQuartier', 'shopAddress'];
    inputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', debouncedUpdatePreview);
    });
    
    const showSearchCheckbox = document.getElementById('showSearchBar');
    if (showSearchCheckbox) {
        showSearchCheckbox.addEventListener('change', debouncedUpdatePreview);
    }
    
    const menuBg = document.getElementById('menuBgColor');
    if (menuBg) menuBg.addEventListener('input', (e) => { designConfig.menuBg = e.target.value; debouncedUpdatePreview(); });
    
    const menuText = document.getElementById('menuTextColor');
    if (menuText) menuText.addEventListener('input', (e) => { designConfig.menuText = e.target.value; debouncedUpdatePreview(); });
    
    document.querySelectorAll('.menu-pos-card').forEach(card => {
        card.addEventListener('click', () => {
            designConfig.menuPosition = card.dataset.pos;
            document.querySelectorAll('.menu-pos-card').forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
            debouncedUpdatePreview();
        });
    });
    
    const carouselHeightSlider = document.getElementById('carouselHeight');
    if (carouselHeightSlider) {
        carouselHeightSlider.addEventListener('input', (e) => {
            designConfig.carouselHeight = parseInt(e.target.value);
            document.getElementById('carouselHeightVal').innerText = e.target.value;
            debouncedUpdatePreview();
        });
    }
    
    const carouselRadiusSlider = document.getElementById('carouselRadius');
    if (carouselRadiusSlider) {
        carouselRadiusSlider.addEventListener('input', (e) => {
            designConfig.carouselRadius = parseInt(e.target.value);
            document.getElementById('carouselRadiusVal').innerText = e.target.value;
            debouncedUpdatePreview();
        });
    }
    
    document.querySelectorAll('.speed-card').forEach(card => {
        card.addEventListener('click', () => {
            designConfig.carouselSpeed = parseInt(card.dataset.speed);
            document.querySelectorAll('.speed-card').forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
            debouncedUpdatePreview();
        });
    });
    
    const menuRadiusSlider = document.getElementById('menuRadius');
    if (menuRadiusSlider) {
        menuRadiusSlider.addEventListener('input', (e) => {
            designConfig.menuRadius = parseInt(e.target.value);
            document.getElementById('menuRadiusVal').innerText = e.target.value;
            debouncedUpdatePreview();
        });
    }
    
    const prodWidthSlider = document.getElementById('prodWidth');
    if (prodWidthSlider) {
        prodWidthSlider.addEventListener('input', (e) => {
            designConfig.prodWidth = parseInt(e.target.value);
            document.getElementById('prodWidthVal').innerText = e.target.value;
            debouncedUpdatePreview();
        });
    }
    
    const prodImgHeightSlider = document.getElementById('prodImgHeight');
    if (prodImgHeightSlider) {
        prodImgHeightSlider.addEventListener('input', (e) => {
            designConfig.prodImgHeight = parseInt(e.target.value);
            document.getElementById('prodImgHeightVal').innerText = e.target.value;
            debouncedUpdatePreview();
        });
    }
    
    const prodRadiusSlider = document.getElementById('prodRadius');
    if (prodRadiusSlider) {
        prodRadiusSlider.addEventListener('input', (e) => {
            designConfig.prodRadius = parseInt(e.target.value);
            document.getElementById('prodRadiusVal').innerText = e.target.value;
            debouncedUpdatePreview();
        });
    }
    
    const prodGapSlider = document.getElementById('prodGap');
    if (prodGapSlider) {
        prodGapSlider.addEventListener('input', (e) => {
            designConfig.prodGap = parseInt(e.target.value);
            document.getElementById('prodGapVal').innerText = e.target.value;
            debouncedUpdatePreview();
        });
    }
    
    document.querySelectorAll('.layout-card').forEach(card => {
        card.addEventListener('click', () => {
            designConfig.layout = card.dataset.layout;
            document.querySelectorAll('.layout-card').forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
            debouncedUpdatePreview();
        });
    });
}

// ============ INITIALISATION ============
// Renvoie true si le compte peut vendre ; sinon affiche le statut de sa demande vendeur
async function canSell(userId) {
    const [approved, admin] = await Promise.all([
        window.supabase.rpc('is_approved_vendor', { target: userId }),
        window.supabase.rpc('is_admin')
    ]);
    if (approved.error) return true;   // migration 20261020 pas encore exécutée : ancien comportement
    if (approved.data || admin.data) return true;
    const { data: app } = await window.supabase.from('vendor_applications').select('status, review_note').eq('user_id', userId).maybeSingle();
    const msg = {
        pending: ['fa-hourglass-half', 'Ta demande vendeur est en cours d\'examen', 'Ouenze va te contacter. Tu pourras créer ta boutique dès que ton compte vendeur sera validé.', 'Voir ma demande'],
        rejected: ['fa-times-circle', 'Ta demande vendeur n\'a pas été retenue', app?.review_note ? 'Motif : ' + app.review_note : 'Tu peux la compléter et la renvoyer.', 'Compléter ma demande'],
        suspended: ['fa-ban', 'Ton compte vendeur est suspendu', app?.review_note ? 'Motif : ' + app.review_note : 'Contacte Ouenze pour en parler.', 'Voir ma demande']
    }[app?.status] || ['fa-store', 'Deviens vendeur Ouenze', 'Ouenze sélectionne ses vendeurs : envoie ta demande, notre équipe te contacte puis valide ton compte.', 'Faire ma demande'];
    const box = document.querySelector('.container');
    if (box) {
        box.innerHTML = `<div class="sd-gate"><i class="fas ${msg[0]}"></i><h2>${escapeHtml(msg[1])}</h2><p>${escapeHtml(msg[2])}</p>
            <a class="btn-primary" href="vendor-register.html">${escapeHtml(msg[3])}</a></div>`;
    }
    return false;
}

async function init() {
    console.log('🚀 Init shop designer...');
    
    const { data: { user }, error } = await window.supabase.auth.getUser();
    
    if (error || !user) {
        window.location.href = 'index.html';
        return;
    }
    
    currentUser = user;
    currentUserEmail = user.email;
    console.log('✅ Utilisateur:', user.email);

    // Vendeurs validés par Ouenze uniquement (la base refuse aussi la création de boutique)
    if (!(await canSell(user.id))) return;
    
    setupLogoUpload();
    setupCarouselUpload();
    setupEventListeners();
    markSelectedCards();
    
    const urlParams = new URLSearchParams(window.location.search);
    const editShopIdParam = urlParams.get('edit');
    
    if (editShopIdParam) {
        await loadShopForEditing(editShopIdParam);
    } else {
        renderCategories();
        renderProductsList();
    }
    
    updatePreview();
    console.log('✅ Aperçu affiché');
}

// ============ EXPORTS ============
window.addCategory = addCategory;
window.removeCategory = removeCategory;
window.updateCategoryName = updateCategoryName;
window.removeCarouselMedia = removeCarouselMedia;
window.openAddProductModal = openAddProductModal;
window.editProduct = editProduct;
window.deleteProduct = deleteProduct;
window.closeProductModal = closeProductModal;
window.saveProduct = saveProduct;
window.updateProductField = updateProductField;
window.removeProductPhoto = removeProductPhoto;
window.toggleVariants = toggleVariants;
window.addVariantOption = addVariantOption;
window.removeVariantOption = removeVariantOption;
window.updateVariantOptionName = updateVariantOptionName;
window.updateVariantOptionValues = updateVariantOptionValues;
window.updateVariantField = updateVariantField;
window.applyBasePriceToVariants = applyBasePriceToVariants;
window.addVariantPhotos = addVariantPhotos;
window.removeVariantPhoto = removeVariantPhoto;
window.toggleFood = toggleFood;
window.toggleBeauty = toggleBeauty;
window.refreshBeautyTargets = () => { renderBeautyTargets(); renderBeautyVersionsHint(); };
window.beautyVersions = beautyVersions;
window.selectBeautyKind = selectBeautyKind;
window.setDefaultVersion = setDefaultVersion;
window.toggleHomemade = toggleHomemade;
window.updatePreview = updatePreview;
// Un seul envoi à la fois : un double clic créait deux boutiques identiques
function oneAtATime(task, buttonId, busyLabel) {
    let running = false;
    return async function () {
        if (running) return;
        running = true;
        const btn = document.getElementById(buttonId);
        const label = btn?.innerHTML;
        if (btn) { btn.disabled = true; btn.textContent = busyLabel; }
        try {
            await task();
        } finally {
            running = false;
            if (btn) { btn.disabled = false; btn.innerHTML = label; }
        }
    };
}
const publishShop = oneAtATime(publishShopNow, 'publishBtn', 'Publication…');
const updateShop = oneAtATime(updateShopNow, 'updateBtn', 'Enregistrement…');

window.publishShop = publishShop;
window.updateShop = updateShop;

init();
