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
function setupCarouselUpload() {
    const carouselInput = document.getElementById('carouselMedia');
    if (carouselInput) {
        carouselInput.addEventListener('change', (e) => {
            const files = Array.from(e.target.files);
            files.forEach(file => {
                const reader = new FileReader();
                reader.onload = ev => {
                    const type = file.type.startsWith('image/') ? 'image' : 'video';
                    carouselMedia.push({ type, src: ev.target.result });
                    renderCarouselList();
                    debouncedUpdatePreview();
                };
                reader.readAsDataURL(file);
            });
            e.target.value = '';
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
    
    if (!productId) {
        tempVariants = [];
        tempVariantOptions = [];
        tempProductPhotos = [];
    } else {
        const product = products.find(p => String(p.id) === String(productId));
        if (product) {
            tempVariants = (product.variants || []).map(v => ({ ...v, values: { ...v.values } }));
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
            <div class="form-group">
                <label id="basePriceLabel">${hasVariants ? 'Prix par défaut des versions (FCFA)' : 'Prix (FCFA) *'}</label>
                <input type="number" id="productBasePrice" min="0" value="${product?.basePrice || ''}">
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

        <button class="btn-primary" onclick="window.saveProduct()">${product ? 'Mettre à jour' : 'Ajouter'}</button>
    `;

    renderProductPhotos(tempProductPhotos);
    renderVariantOptions();
    renderVariantCombos();

    const photoInput = document.getElementById('productPhotoInput');
    if (photoInput) photoInput.addEventListener('change', handleProductPhotoUpload);
}

// ============ VARIANTES ============
const MAX_VARIANT_OPTIONS = 3;
const MAX_VARIANT_COMBOS = 100;
const OPTION_SUGGESTIONS = ['Couleur', 'Taille', 'Pointure', 'Capacité', 'Modèle', 'Version', 'Saveur', 'Contenance'];

function toggleVariants(on) {
    document.getElementById('variantsSection').style.display = on ? '' : 'none';
    document.getElementById('productStockGroup').style.display = on ? 'none' : '';
    document.getElementById('basePriceLabel').innerText = on ? 'Prix par défaut des versions (FCFA)' : 'Prix (FCFA) *';
    if (on && tempVariantOptions.length === 0) addVariantOption();
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
    const basePrice = parseFloat(document.getElementById('productBasePrice')?.value) || '';
    tempVariants = combos.map(values => {
        const key = comboKey(values);
        const old = previous.get(key);
        return { key, values, price: old ? old.price : basePrice, stock: old ? old.stock : 0 };
    });

    if (tempVariants.length === 0) {
        container.innerHTML = '<p class="hint">Renseignez au moins une option et ses valeurs pour créer les versions.</p>';
        return;
    }

    container.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <strong style="font-size:13px;">${tempVariants.length} version(s)</strong>
            <button type="button" class="btn-sm" onclick="window.applyBasePriceToVariants()">Appliquer le prix par défaut à toutes</button>
        </div>
        <table class="variants-table">
            <thead><tr><th>Version</th><th>Prix (FCFA)</th><th>Stock</th></tr></thead>
            <tbody>
                ${tempVariants.map((v, i) => `
                    <tr>
                        <td>${escapeHtml(v.key)}</td>
                        <td><input type="number" min="0" value="${v.price}" onchange="window.updateVariantField(${i}, 'price', this.value)"></td>
                        <td><input type="number" min="0" value="${v.stock}" onchange="window.updateVariantField(${i}, 'stock', this.value)"></td>
                    </tr>`).join('')}
            </tbody>
        </table>`;
}

function updateVariantField(idx, field, value) {
    if (!tempVariants[idx]) return;
    tempVariants[idx][field] = field === 'price' ? (parseFloat(value) || '') : (parseInt(value) || 0);
}

function applyBasePriceToVariants() {
    const base = parseFloat(document.getElementById('productBasePrice')?.value);
    if (isNaN(base) || base <= 0) { alert("Saisissez d'abord un prix par défaut"); return; }
    tempVariants.forEach(v => { v.price = base; });
    renderVariantCombos();
}

// ============ ALIMENTAIRE ============
function toggleFood(on) {
    document.getElementById('foodSection').style.display = on ? '' : 'none';
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
    files.forEach(file => {
        const reader = new FileReader();
        reader.onload = ev => {
            tempProductPhotos.push(ev.target.result);
            renderProductPhotos(tempProductPhotos);
        };
        reader.readAsDataURL(file);
    });
    e.target.value = '';
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
        variants = tempVariants.map(v => ({ key: v.key, values: v.values, price: Number(v.price), stock: Number(v.stock) || 0 }));
    } else if (isNaN(basePrice) || basePrice <= 0) {
        alert("Prix valide requis"); return;
    }

    const { food, error: foodError } = readFoodForm();
    if (foodError) { alert(foodError); return; }

    const productData = {
        id: editingProductId || Date.now(),
        name, categoryId, description,
        // Avec variantes : prix affiché = le moins cher, stock = somme des versions
        basePrice: variants.length ? Math.min(...variants.map(v => v.price)) : basePrice,
        stock: variants.length ? variants.reduce((s, v) => s + v.stock, 0) : (stock || 0),
        photos: tempProductPhotos,
        variantOptions,
        variants,
        food
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
                    Catégorie: ${escapeHtml(category?.name || 'Sans catégorie')} | ${p.photos?.length || 0} photo(s)
                    ${hasVariants ? ` | ${p.variants.length} version(s) : ${escapeHtml((p.variantOptions || []).map(o => o.name).join(', '))}` : ''}
                </div>
                ${p.food ? `<div class="food-badge">🍽️ ${escapeHtml(foodSummary(p.food))}</div>` : ''}
                ${p.photos && p.photos.length > 0 ? `
                    <div style="display:flex;gap:8px;margin-top:8px;">
                        ${p.photos.slice(0, 5).map(photo => `
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
                                    ${p.photos?.[0] ? `<img src="${p.photos[0]}" style="width:100%;height:100%;object-fit:cover;">` : '<i class="fas fa-image" style="font-size:32px;color:#cbd5e1;"></i>'}
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

// ============ PUBLICATION ============
async function publishShop() {
    console.log('🚀 Publication...');
    
    const name = document.getElementById('shopNameInput').value.trim();
    if (!name) { alert("Nom de boutique requis"); return; }
    if (categories.length === 0) { alert("Créez au moins une catégorie"); return; }
    if (products.length === 0) { alert("Ajoutez au moins un produit"); return; }
    
    const { data: { user }, error: userError } = await window.supabase.auth.getUser();
    if (userError || !user) { alert("Connectez-vous"); return; }
    
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
        design: {
            menu_position: designConfig.menuPosition,
            menu_bg: designConfig.menuBg,
            menu_text: designConfig.menuText,
            menu_radius: designConfig.menuRadius,
            carousel_height: designConfig.carouselHeight,
            carousel_radius: designConfig.carouselRadius,
            carousel_speed: designConfig.carouselSpeed,
            prod_width: designConfig.prodWidth,
            prod_img_height: designConfig.prodImgHeight,
            prod_radius: designConfig.prodRadius,
            prod_gap: designConfig.prodGap,
            layout: designConfig.layout,
            primary_color: document.getElementById('primaryColor').value,
            button_color: document.getElementById('buttonColor').value,
            background_color: document.getElementById('bgColor').value,
            header_text_color: document.getElementById('headerTextColor').value,
            product_text_color: document.getElementById('productTextColor').value
        }
    };
    
    try {
        const { data: insertedShop, error: shopError } = await window.supabase
            .from('shops').insert([shopData]).select().single();
        
        if (shopError) {
            console.error('❌', shopError);
            alert('Erreur: ' + shopError.message);
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
                shop_id: insertedShop.id,
                category_id: categoryIdMap.get(String(p.categoryId)) || null,
                name: p.name,
                slug: generateSlug(p.name) + '-' + Date.now() + '-' + Math.random().toString(36).substring(7),
                description: p.description || '',
                price: p.basePrice || p.price || 0,
                stock: p.stock || 0,
                product_type: p.food ? 'food' : 'standard',
                photos: p.photos || [],
                variants: { options: p.variantOptions || [], items: p.variants || [] },
                food_info: p.food || null
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
async function updateShop() {
    if (!editingShopId) { alert("Erreur"); return; }
    const name = document.getElementById('shopNameInput').value.trim();
    if (!name) { alert("Nom requis"); return; }
    
    const { data: { user } } = await window.supabase.auth.getUser();
    if (!user) { alert("Connectez-vous"); return; }
    
    const updates = {
        name: name,
        description: document.getElementById('shopDescInput').value || '',
        logo_url: tempLogo || '',
        city: document.getElementById('shopCity').value || 'Brazzaville',
        district: document.getElementById('shopQuartier').value || '',
        address: document.getElementById('shopAddress')?.value || ''
    };
    
    const { error } = await window.supabase
        .from('shops').update(updates).eq('id', editingShopId).eq('owner_id', user.id);
    
    if (error) { alert('Erreur: ' + error.message); return; }
    
    alert(`✅ Boutique mise à jour !`);
    window.location.href = 'vendor-dashboard.html';
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
        food: p.food_info || null
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
    
    setupLogoUpload();
    setupCarouselUpload();
    setupEventListeners();
    
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
window.toggleFood = toggleFood;
window.toggleHomemade = toggleHomemade;
window.updatePreview = updatePreview;
window.publishShop = publishShop;
window.updateShop = updateShop;

init();
