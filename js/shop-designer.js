// ============================================================
// SHOP-DESIGNER.JS — VERSION SUPABASE COMPLÈTE
// Aperçu + Publication + Modification
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
let tempVariants = [];
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
    return Number(v || 0).toLocaleString();
}

function generateSlug(text) {
    return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function debouncedUpdatePreview() {
    if (updateTimeout) clearTimeout(updateTimeout);
    updateTimeout = setTimeout(() => updatePreview(), 100);
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
    const cat = categories.find(c => c.id === catId);
    if (cat) cat.name = newName;
    debouncedUpdatePreview();
}

function removeCategory(id) {
    if (confirm("Supprimer cette catégorie ?")) {
        if (products.some(p => p.categoryId === id)) {
            alert("Supprimez d'abord les produits de cette catégorie");
            return;
        }
        categories = categories.filter(c => c.id !== id);
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
                       onchange="window.updateCategoryName(${cat.id}, this.value)" style="flex:1;">
                <button class="btn-danger" onclick="window.removeCategory(${cat.id})">Supprimer</button>
            </div>
            <div class="category-products">${products.filter(p => p.categoryId === cat.id).length} produit(s)</div>
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
        tempProductPhotos = [];
    } else {
        const product = products.find(p => p.id === productId);
        if (product) {
            tempVariants = [...(product.variants || [])];
            tempProductPhotos = [...(product.photos || [])];
        }
    }
    
    renderProductForm();
    document.getElementById('modalTitle').innerText = productId ? 'Modifier le produit' : 'Ajouter un produit';
    document.getElementById('productModal').classList.add('active');
}

function renderProductForm() {
    const product = editingProductId ? products.find(p => p.id === editingProductId) : null;
    const form = document.getElementById('productForm');
    if (!form) return;
    
    form.innerHTML = `
        <div class="form-group">
            <label>Nom du produit *</label>
            <input type="text" id="productName" value="${escapeHtml(product?.name || '')}">
        </div>
        <div class="form-group">
            <label>Catégorie *</label>
            <select id="productCategory">
                ${categories.map(cat => `<option value="${cat.id}" ${product?.categoryId === cat.id ? 'selected' : ''}>${escapeHtml(cat.name)}</option>`).join('')}
            </select>
        </div>
        <div class="form-row">
            <div class="form-group">
                <label>Prix (FCFA)</label>
                <input type="number" id="productBasePrice" value="${product?.basePrice || ''}">
            </div>
            <div class="form-group">
                <label>Stock</label>
                <input type="number" id="productStock" value="${product?.stock || 0}">
            </div>
        </div>
        <div class="form-group">
            <label>Description</label>
            <textarea id="productDesc" rows="3">${escapeHtml(product?.description || '')}</textarea>
        </div>
        <div class="form-group">
            <label>Photos</label>
            <div id="productPhotosContainer" class="photo-gallery"></div>
            <input type="file" id="productPhotoInput" accept="image/*" multiple>
        </div>
        <button class="btn-primary" onclick="window.saveProduct()">${product ? 'Mettre à jour' : 'Ajouter'}</button>
    `;
    
    renderProductPhotos(tempProductPhotos);
    
    const photoInput = document.getElementById('productPhotoInput');
    if (photoInput) photoInput.addEventListener('change', handleProductPhotoUpload);
}

function renderProductPhotos(photos) {
    const container = document.getElementById('productPhotosContainer');
    if (!container) return;
    if (photos.length === 0) {
        container.innerHTML = '<div style="padding:10px;color:var(--gray-500);">Aucune photo</div>';
        return;
    }
    container.innerHTML = photos.map((photo, idx) => `
        <div class="photo-item">
            <img src="${photo}">
            <div class="remove-photo" onclick="window.removeProductPhoto(${idx})">✕</div>
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
    const categoryId = parseInt(document.getElementById('productCategory').value);
    const basePrice = parseFloat(document.getElementById('productBasePrice').value);
    const stock = parseInt(document.getElementById('productStock').value);
    const description = document.getElementById('productDesc').value;
    
    if (!name) { alert("Nom requis"); return; }
    if (!categoryId) { alert("Catégorie requise"); return; }
    if (isNaN(basePrice) || basePrice <= 0) { alert("Prix valide requis"); return; }
    
    const productData = {
        id: editingProductId || Date.now(),
        name, categoryId, basePrice, stock, description,
        photos: tempProductPhotos,
        variants: []
    };
    
    if (editingProductId) {
        const index = products.findIndex(p => p.id === editingProductId);
        if (index !== -1) products[index] = productData;
    } else {
        products.push(productData);
    }
    
    closeProductModal();
    renderProductsList();
    renderCategories();
    debouncedUpdatePreview();
    alert(editingProductId ? "Produit modifié" : "Produit ajouté");
}

function renderProductsList() {
    const container = document.getElementById('productsContainer');
    if (!container) return;
    if (products.length === 0) {
        container.innerHTML = '<div style="text-align:center;padding:20px;">Aucun produit</div>';
        return;
    }
    container.innerHTML = products.map(p => {
        const category = categories.find(c => c.id === p.categoryId);
        return `
            <div class="product-item">
                <div class="product-header">
                    <input type="text" class="product-name-input" value="${escapeHtml(p.name)}" 
                           onchange="window.updateProductField(${p.id}, 'name', this.value)" placeholder="Nom">
                    <input type="number" class="product-price-input" value="${p.basePrice}" 
                           onchange="window.updateProductField(${p.id}, 'price', parseFloat(this.value))" placeholder="Prix">
                    <input type="number" class="product-stock-input" value="${p.stock}" 
                           onchange="window.updateProductField(${p.id}, 'stock', parseInt(this.value))" placeholder="Stock">
                    <div>
                        <button class="btn-sm" onclick="window.editProduct(${p.id})">Modifier</button>
                        <button class="btn-sm" style="background:#fee2e2;" onclick="window.deleteProduct(${p.id})">Supprimer</button>
                    </div>
                </div>
                <div style="font-size:12px; color:var(--gray-500);">
                    Catégorie: ${category?.name || 'Sans catégorie'}
                </div>
            </div>
        `;
    }).join('');
}

function updateProductField(productId, field, value) {
    const product = products.find(p => p.id === productId);
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
        products = products.filter(p => p.id !== id);
        renderProductsList();
        renderCategories();
        debouncedUpdatePreview();
    }
}

function closeProductModal() {
    document.getElementById('productModal').classList.remove('active');
    tempProductPhotos = [];
    tempVariants = [];
    editingProductId = null;
}

// ============ APERÇU EN TEMPS RÉEL ============
// ============ APERÇU EN TEMPS RÉEL (VERSION COMPLÈTE) ============
// ============ APERÇU EN TEMPS RÉEL ============
function updatePreview() {
    const preview = document.getElementById('livePreview');
    if (!preview) {
        console.warn('⚠️ livePreview introuvable');
        return;
    }
    
    // Récupérer TOUTES les valeurs
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
    
    // Configuration menu
    const menuPosition = designConfig.menuPosition;
    const isVertical = menuPosition === 'vertical-left' || menuPosition === 'vertical-right';
    const floatDir = menuPosition === 'vertical-left' ? 'left' : 'right';
    
    // Générer le menu
    let menuHtml = '';
    if (categories.length > 0) {
        if (isVertical) {
            menuHtml = `
                <div style="
                    background:${designConfig.menuBg};
                    color:${designConfig.menuText};
                    border-radius:${designConfig.menuRadius}px;
                    float:${floatDir};
                    width:160px;
                    margin-${floatDir === 'left' ? 'right' : 'left'}:16px;
                    padding:12px;
                ">
                    ${categories.map(cat => `<div style="padding:6px 0;font-size:13px;">${escapeHtml(cat.name)}</div>`).join('')}
                </div>
            `;
        } else {
            menuHtml = `
                <div style="
                    background:${designConfig.menuBg};
                    color:${designConfig.menuText};
                    border-radius:${designConfig.menuRadius}px;
                    padding:10px 16px;
                    display:flex;
                    gap:16px;
                    flex-wrap:wrap;
                ">
                    ${categories.map(cat => `<span style="font-size:13px;">${escapeHtml(cat.name)}</span>`).join('')}
                </div>
            `;
        }
    }
    
    // Marge du contenu
    const contentMargin = isVertical 
        ? (floatDir === 'left' ? 'margin-left:176px;' : 'margin-right:176px;')
        : '';
    
    // Layout produits
    const productsStyle = designConfig.layout === 'grid'
        ? `display:grid;grid-template-columns:repeat(auto-fill,minmax(${designConfig.prodWidth}px,1fr));gap:${designConfig.prodGap}px;`
        : `display:flex;flex-direction:column;gap:${designConfig.prodGap}px;`;
    
    preview.innerHTML = `
        <div style="background:${bgColor};border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.05);">
            
            <!-- HEADER -->
            <div style="background:linear-gradient(135deg,${primaryColor},${primaryColor}aa);padding:20px;color:${headerTextColor};">
                <div style="display:flex;align-items:center;gap:12px;">
                    <div style="width:55px;height:55px;background:white;border-radius:12px;display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;">
                        ${tempLogo 
                            ? `<img src="${tempLogo}" style="width:100%;height:100%;object-fit:contain;">` 
                            : '<i class="fas fa-store" style="font-size:24px;color:#1e40af;"></i>'
                        }
                    </div>
                    <div style="flex:1;">
                        <h3 style="font-size:16px;margin:0;">${escapeHtml(shopName)}</h3>
                        <p style="font-size:11px;margin:4px 0;opacity:0.9;">${escapeHtml(desc)}</p>
                        <div style="font-size:10px;"><i class="fas fa-map-marker-alt"></i> ${escapeHtml(city)} ${escapeHtml(quartier)}</div>
                    </div>
                </div>
            </div>
            
            <!-- BARRE DE RECHERCHE -->
            ${showSearch ? `
                <div class="preview-search-bar" style="background:${bgColor};">
                    <div class="preview-search-input">
                        <input type="text" placeholder="Rechercher un produit..." disabled>
                        <i class="fas fa-search" style="color:${primaryColor};"></i>
                    </div>
                </div>
            ` : ''}
            
            <!-- MENU -->
            ${menuHtml}
            
            <!-- CONTENU PRODUITS -->
            <div style="padding:16px;${contentMargin}">
                <h4 style="font-size:14px;margin-bottom:12px;">Produits (${products.length})</h4>
                ${products.length > 0 ? `
                    <div style="${productsStyle}">
                        ${products.slice(0, 6).map(p => `
                            <div style="
                                background:white;
                                border-radius:${designConfig.prodRadius}px;
                                border:1px solid #e2e8f0;
                                overflow:hidden;
                                ${designConfig.layout === 'list' ? 'display:flex;gap:12px;' : ''}
                            ">
                                <div style="
                                    height:${designConfig.layout === 'list' ? '80px' : designConfig.prodImgHeight + 'px'};
                                    ${designConfig.layout === 'list' ? 'width:80px;' : ''}
                                    background:#f1f5f9;
                                    display:flex;
                                    align-items:center;
                                    justify-content:center;
                                    flex-shrink:0;
                                ">
                                    ${p.photos?.[0] 
                                        ? `<img src="${p.photos[0]}" style="width:100%;height:100%;object-fit:cover;">` 
                                        : '<i class="fas fa-image" style="font-size:32px;color:#cbd5e1;"></i>'
                                    }
                                </div>
                                <div style="padding:12px;flex:1;">
                                    <div style="font-weight:600;font-size:14px;color:${productTextColor};margin-bottom:4px;">${escapeHtml(p.name)}</div>
                                    <div style="font-weight:700;color:${primaryColor};font-size:14px;">${formatNumber(p.basePrice)} FCFA</div>
                                    <button style="
                                        background:${buttonColor};
                                        color:white;
                                        border:none;
                                        padding:8px;
                                        border-radius:30px;
                                        width:100%;
                                        cursor:pointer;
                                        font-size:12px;
                                        font-weight:500;
                                        margin-top:8px;
                                    ">
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
    
    // Récupérer toutes les valeurs
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
    
    // Configuration menu
    const menuPosition = designConfig.menuPosition;
    const isVertical = menuPosition === 'vertical-left' || menuPosition === 'vertical-right';
    const floatDir = menuPosition === 'vertical-left' ? 'left' : 'right';
    
    // Générer le menu selon la position
    let menuHtml = '';
    if (isVertical) {
        menuHtml = `
            <div style="
                background:${designConfig.menuBg};
                color:${designConfig.menuText};
                border-radius:${designConfig.menuRadius}px;
                float:${floatDir};
                width:160px;
                margin-${floatDir === 'left' ? 'right' : 'left'}:16px;
                padding:10px;
            ">
                ${categories.length > 0 
                    ? categories.map(cat => `<div style="padding:6px 0;font-size:13px;">${escapeHtml(cat.name)}</div>`).join('')
                    : '<div style="padding:6px 0;font-size:12px;opacity:0.7;">Aucune catégorie</div>'
                }
            </div>
        `;
    } else {
        menuHtml = `
            <div style="
                background:${designConfig.menuBg};
                color:${designConfig.menuText};
                border-radius:${designConfig.menuRadius}px;
                padding:8px 16px;
                display:flex;
                gap:16px;
                flex-wrap:wrap;
            ">
                ${categories.length > 0 
                    ? categories.map(cat => `<span style="font-size:13px;">${escapeHtml(cat.name)}</span>`).join('')
                    : '<span style="font-size:12px;opacity:0.7;">Aucune catégorie</span>'
                }
            </div>
        `;
    }
    
    // Marge du contenu si menu vertical
    const contentMargin = isVertical 
        ? (floatDir === 'left' ? 'margin-left:176px;' : 'margin-right:176px;')
        : '';
    
    // Layout des produits
    const productsStyle = designConfig.layout === 'grid'
        ? `display:grid;grid-template-columns:repeat(auto-fill,minmax(${designConfig.prodWidth}px,1fr));gap:${designConfig.prodGap}px;`
        : `display:flex;flex-direction:column;gap:${designConfig.prodGap}px;`;
    
    preview.innerHTML = `
        <div style="background:${bgColor};border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.05);">
            
            <!-- HEADER -->
            <div style="background:linear-gradient(135deg,${primaryColor},${primaryColor}aa);padding:20px;color:${headerTextColor};">
                <div style="display:flex;align-items:center;gap:12px;">
                    <div style="width:55px;height:55px;background:white;border-radius:12px;display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;">
                        ${tempLogo 
                            ? `<img src="${tempLogo}" style="width:100%;height:100%;object-fit:contain;">` 
                            : '<i class="fas fa-store" style="font-size:24px;color:#1e40af;"></i>'
                        }
                    </div>
                    <div style="flex:1;">
                        <h3 style="font-size:16px;margin:0;">${escapeHtml(shopName)}</h3>
                        <p style="font-size:11px;margin:4px 0;opacity:0.9;">${escapeHtml(desc)}</p>
                        <div style="font-size:10px;"><i class="fas fa-map-marker-alt"></i> ${escapeHtml(city)} ${escapeHtml(quartier)}</div>
                    </div>
                </div>
            </div>
            
            <!-- BARRE DE RECHERCHE -->
            ${showSearch ? `
                <div style="padding:12px 16px;background:${bgColor};border-bottom:1px solid #e2e8f0;">
                    <div style="display:flex;background:#f1f5f9;border-radius:20px;padding:6px 12px;">
                        <input type="text" placeholder="Rechercher un produit..." style="flex:1;border:none;background:transparent;outline:none;font-size:13px;" disabled>
                        <i class="fas fa-search" style="color:${primaryColor};"></i>
                    </div>
                </div>
            ` : ''}
            
            <!-- MENU -->
            ${categories.length > 0 ? menuHtml : ''}
            
            <!-- CONTENU -->
            <div style="padding:16px;${contentMargin}">
                <h4 style="font-size:14px;margin-bottom:12px;">Produits (${products.length})</h4>
                ${products.length > 0 ? `
                    <div style="${productsStyle}">
                        ${products.slice(0, 6).map(p => `
                            <div style="
                                background:white;
                                border-radius:${designConfig.prodRadius}px;
                                border:1px solid #e2e8f0;
                                overflow:hidden;
                                ${designConfig.layout === 'list' ? 'display:flex;gap:12px;' : ''}
                            ">
                                <div style="
                                    height:${designConfig.layout === 'list' ? '80px' : designConfig.prodImgHeight + 'px'};
                                    ${designConfig.layout === 'list' ? 'width:80px;' : ''}
                                    background:#f1f5f9;
                                    display:flex;
                                    align-items:center;
                                    justify-content:center;
                                    flex-shrink:0;
                                ">
                                    ${p.photos?.[0] 
                                        ? `<img src="${p.photos[0]}" style="width:100%;height:100%;object-fit:cover;">` 
                                        : '<i class="fas fa-image" style="font-size:32px;color:#cbd5e1;"></i>'
                                    }
                                </div>
                                <div style="padding:12px;flex:1;">
                                    <div style="font-weight:600;font-size:14px;color:${productTextColor};margin-bottom:4px;">${escapeHtml(p.name)}</div>
                                    <div style="font-weight:700;color:${primaryColor};font-size:14px;">${formatNumber(p.basePrice)} FCFA</div>
                                    <button style="
                                        background:${buttonColor};
                                        color:white;
                                        border:none;
                                        padding:8px;
                                        border-radius:30px;
                                        width:100%;
                                        cursor:pointer;
                                        font-size:12px;
                                        font-weight:500;
                                        margin-top:8px;
                                    ">
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
    
    const shopName = document.getElementById('shopNameInput')?.value || 'Ma boutique';
    const desc = document.getElementById('shopDescInput')?.value || '';
    const city = document.getElementById('shopCity')?.value || 'Brazzaville';
    const quartier = document.getElementById('shopQuartier')?.value || '';
    const primaryColor = document.getElementById('primaryColor')?.value || '#1e40af';
    const buttonColor = document.getElementById('buttonColor')?.value || '#1e40af';
    const bgColor = document.getElementById('bgColor')?.value || '#ffffff';
    const headerTextColor = document.getElementById('headerTextColor')?.value || '#ffffff';
    const productTextColor = document.getElementById('productTextColor')?.value || '#1e293b';
    
    preview.innerHTML = `
        <div style="background:${bgColor};border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.05);">
            <div style="background:linear-gradient(135deg,${primaryColor},${primaryColor}aa);padding:20px;color:${headerTextColor};">
                <div style="display:flex;align-items:center;gap:12px;">
                    <div style="width:55px;height:55px;background:white;border-radius:12px;display:flex;align-items:center;justify-content:center;overflow:hidden;">
                        ${tempLogo ? `<img src="${tempLogo}" style="width:100%;height:100%;object-fit:contain;">` : '<i class="fas fa-store" style="font-size:24px;color:#1e40af;"></i>'}
                    </div>
                    <div>
                        <h3 style="font-size:16px;margin:0;">${escapeHtml(shopName)}</h3>
                        <p style="font-size:11px;margin:4px 0;opacity:0.9;">${escapeHtml(desc)}</p>
                        <div style="font-size:10px;"><i class="fas fa-map-marker-alt"></i> ${escapeHtml(city)} ${escapeHtml(quartier)}</div>
                    </div>
                </div>
            </div>
            
            ${categories.length > 0 ? `
                <div style="background:${designConfig.menuBg};color:${designConfig.menuText};padding:8px 16px;display:flex;gap:16px;flex-wrap:wrap;">
                    ${categories.map(cat => `<span style="font-size:13px;">${escapeHtml(cat.name)}</span>`).join('')}
                </div>
            ` : ''}
            
            <div style="padding:16px;">
                <h4 style="font-size:14px;margin-bottom:12px;">Produits (${products.length})</h4>
                ${products.length > 0 ? `
                    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:${designConfig.prodGap}px;">
                        ${products.slice(0, 6).map(p => `
                            <div style="background:white;border-radius:${designConfig.prodRadius}px;border:1px solid #e2e8f0;overflow:hidden;">
                                <div style="height:${designConfig.prodImgHeight}px;background:#f1f5f9;display:flex;align-items:center;justify-content:center;">
                                    ${p.photos?.[0] ? `<img src="${p.photos[0]}" style="width:100%;height:100%;object-fit:cover;">` : '<i class="fas fa-image" style="font-size:32px;color:#cbd5e1;"></i>'}
                                </div>
                                <div style="padding:12px;">
                                    <div style="font-weight:600;font-size:14px;color:${productTextColor};margin-bottom:4px;">${escapeHtml(p.name)}</div>
                                    <div style="font-weight:700;color:${primaryColor};font-size:14px;">${formatNumber(p.basePrice)} FCFA</div>
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

// ============ PUBLICATION VIA SUPABASE ============
async function publishShop() {
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
    // AJOUTER CES LIGNES :
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
    console.log('🚀 Publication...');
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
    show_search_bar: document.getElementById('showSearchBar')?.checked || false,  // ← AJOUTER
    design: {  // ← AJOUTER TOUT LE DESIGN
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
    const name = document.getElementById('shopNameInput').value.trim();
    if (!name) { alert("Nom de boutique requis"); return; }
    if (categories.length === 0) { alert("Créez au moins une catégorie"); return; }
    if (products.length === 0) { alert("Ajoutez au moins un produit"); return; }
    
    const { data: { user }, error: userError } = await window.supabase.auth.getUser();
    
    if (userError || !user) {
        alert("Vous devez être connecté");
        window.location.href = 'index.html';
        return;
    }
    
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
        is_active: true
    };
    
    try {
        const { data: insertedShop, error: shopError } = await window.supabase
            .from('shops').insert([shopData]).select().single();
        
        if (shopError) {
            console.error('❌ Erreur boutique:', shopError);
            alert('Erreur: ' + shopError.message);
            return;
        }
        
        console.log('✅ Boutique créée:', insertedShop);
        
        // Catégories
        if (categories.length > 0) {
            const categoriesData = categories.map(cat => ({
                shop_id: insertedShop.id,
                name: cat.name
            }));
            await window.supabase.from('categories').insert(categoriesData);
        }
        
        // Produits
        if (products.length > 0) {
            const productsData = products.map(p => ({
                shop_id: insertedShop.id,
                name: p.name,
                slug: generateSlug(p.name) + '-' + Date.now() + '-' + Math.random().toString(36).substring(7),
                description: p.description || '',
                price: p.basePrice || p.price || 0,
                stock: p.stock || 0,
                product_type: 'standard',
                photos: p.photos || []
            }));
            
            const { error: prodError } = await window.supabase.from('products').insert(productsData);
            if (prodError) console.error('❌ Erreur produits:', prodError);
        }
        
        alert(`✅ Boutique "${name}" créée avec succès !`);
        window.location.href = 'vendor-dashboard.html';
        
    } catch (error) {
        console.error('❌ Erreur:', error);
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
    
    try {
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
        
        alert(`✅ Boutique "${name}" mise à jour !`);
        window.location.href = 'vendor-dashboard.html';
        
    } catch (error) {
        console.error('❌ Erreur:', error);
        alert('Erreur');
    }
}

// ============ CHARGEMENT POUR ÉDITION ============
async function loadShopForEditing(shopId) {
    const { data: { user } } = await window.supabase.auth.getUser();
    if (!user) { alert("Connectez-vous"); return false; }
    
    const { data: shop, error } = await window.supabase
        .from('shops').select('*').eq('id', shopId).eq('owner_id', user.id).single();
    
    if (error || !shop) { alert("Boutique non trouvée"); return false; }
    
    editingShopId = shop.id;
    document.getElementById('shopNameInput').value = shop.name || '';
    document.getElementById('shopDescInput').value = shop.description || '';
    document.getElementById('shopCity').value = shop.city || '';
    document.getElementById('shopQuartier').value = shop.district || '';
    if (document.getElementById('shopAddress')) document.getElementById('shopAddress').value = shop.address || '';
    
    if (shop.logo_url) {
        tempLogo = shop.logo_url;
        document.getElementById('logoPreview').innerHTML = `<img src="${shop.logo_url}" style="width:100%;height:100%;object-fit:contain;">`;
    }
    
    // Charger catégories
    const { data: cats } = await window.supabase.from('categories').select('*').eq('shop_id', shopId);
    categories = (cats || []).map(c => ({ id: c.id, name: c.name }));
    
    // Charger produits
    const { data: prods } = await window.supabase.from('products').select('*').eq('shop_id', shopId);
    products = (prods || []).map(p => ({
        id: p.id,
        name: p.name,
        categoryId: p.category_id,
        basePrice: p.price,
        stock: p.stock,
        description: p.description,
        photos: p.photos || []
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
    // Barre de recherche
const showSearchCheckbox = document.getElementById('showSearchBar');
if (showSearchCheckbox) {
    showSearchCheckbox.addEventListener('change', () => {
        console.log('✅ Barre de recherche:', showSearchCheckbox.checked);
        updatePreview();
    });
}
    // Inputs texte
    // Barre de recherche
const showSearchCheckbox = document.getElementById('showSearchBar');
if (showSearchCheckbox) {
    showSearchCheckbox.addEventListener('change', debouncedUpdatePreview);
}
    const inputs = ['primaryColor', 'buttonColor', 'bgColor', 'headerTextColor', 'productTextColor',
                    'shopNameInput', 'shopDescInput', 'shopCity', 'shopQuartier', 'shopAddress'];
    inputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', debouncedUpdatePreview);
    });
    
    // ===== MENU =====
    const menuBg = document.getElementById('menuBgColor');
    if (menuBg) menuBg.addEventListener('input', (e) => { 
        designConfig.menuBg = e.target.value; 
        debouncedUpdatePreview(); 
    });
    
    const menuText = document.getElementById('menuTextColor');
    if (menuText) menuText.addEventListener('input', (e) => { 
        designConfig.menuText = e.target.value; 
        debouncedUpdatePreview(); 
    });
    
    // Position menu
    document.querySelectorAll('.menu-pos-card').forEach(card => {
        card.addEventListener('click', () => {
            designConfig.menuPosition = card.dataset.pos;
            document.querySelectorAll('.menu-pos-card').forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
            console.log('✅ Position menu:', designConfig.menuPosition);
            debouncedUpdatePreview();
        });
    });
    
    // ===== CARROUSEL =====
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
    
    // Vitesse carrousel
    document.querySelectorAll('.speed-card').forEach(card => {
        card.addEventListener('click', () => {
            designConfig.carouselSpeed = parseInt(card.dataset.speed);
            document.querySelectorAll('.speed-card').forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
            console.log('✅ Vitesse carrousel:', designConfig.carouselSpeed);
            debouncedUpdatePreview();
        });
    });
    
    // ===== MENU RADIUS =====
    const menuRadiusSlider = document.getElementById('menuRadius');
    if (menuRadiusSlider) {
        menuRadiusSlider.addEventListener('input', (e) => {
            designConfig.menuRadius = parseInt(e.target.value);
            document.getElementById('menuRadiusVal').innerText = e.target.value;
            debouncedUpdatePreview();
        });
    }
    
    // ===== AFFICHAGE PRODUITS =====
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
    
    // Layout produits
    document.querySelectorAll('.layout-card').forEach(card => {
        card.addEventListener('click', () => {
            designConfig.layout = card.dataset.layout;
            document.querySelectorAll('.layout-card').forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
            console.log('✅ Layout:', designConfig.layout);
            debouncedUpdatePreview();
        });
    });
}

// ============ INITIALISATION ============
async function init() {
    console.log('🚀 Init shop designer...');
    
    const { data: { user }, error } = await window.supabase.auth.getUser();
    
    if (error || !user) {
        console.warn('⛔ Non connecté');
        window.location.href = 'index.html';
        return;
    }
    
    currentUser = user;
    currentUserEmail = user.email;
    console.log('✅ Utilisateur:', user.email);
    
    setupLogoUpload();
    setupEventListeners();
    
    const urlParams = new URLSearchParams(window.location.search);
    const editShopIdParam = urlParams.get('edit');
    
    if (editShopIdParam) {
        await loadShopForEditing(editShopIdParam);
    } else {
        renderCategories();
        renderProductsList();
    }
    
    // Forcer l'affichage de l'aperçu
    updatePreview();
    console.log('✅ Aperçu affiché');
}

// ============ EXPORTS ============
window.addCategory = addCategory;
window.removeCategory = removeCategory;
window.updateCategoryName = updateCategoryName;
window.openAddProductModal = openAddProductModal;
window.editProduct = editProduct;
window.deleteProduct = deleteProduct;
window.closeProductModal = closeProductModal;
window.saveProduct = saveProduct;
window.updateProductField = updateProductField;
window.removeProductPhoto = removeProductPhoto;
window.updatePreview = updatePreview;
window.publishShop = publishShop;
window.updateShop = updateShop;

window.addEventListener('beforeunload', () => {
    if (carouselInterval) clearInterval(carouselInterval);
});

init();
