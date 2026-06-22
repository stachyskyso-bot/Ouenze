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

// Configuration design
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

// ============ FONCTIONS UTILITAIRES ============
function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]));
}

function formatNumber(value) {
    return Number(value || 0).toLocaleString();
}

function debouncedUpdatePreview() {
    if (updateTimeout) clearTimeout(updateTimeout);
    updateTimeout = setTimeout(() => updatePreview(), 100);
}

// ============ GESTION DES CATÉGORIES ============
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

// ============ GESTION DU CARROUSEL ============
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
        container.innerHTML = '<div style="color:var(--gray-500);">Aucun média</div>';
        return;
    }
    
    container.innerHTML = carouselMedia.map((m, i) => `
        <div class="carousel-media-item">
            ${m.type === 'image' ? `<img src="${m.src}">` : `<video src="${m.src}" muted playsinline></video>`}
            <div class="remove-media" onclick="window.removeCarouselMedia(${i})">✕</div>
        </div>
    `).join('');
}

// ============ GESTION DES PRODUITS ============
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
            <label>Type de produit</label>
            <select id="productType" onchange="window.toggleProductFields()">
                <option value="standard" ${product?.type === 'standard' || !product ? 'selected' : ''}>Standard</option>
                <option value="food" ${product?.type === 'food' ? 'selected' : ''}>Alimentaire</option>
            </select>
        </div>
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
            <label>Couleurs et variantes</label>
            <div id="variantsContainer"></div>
            <button type="button" class="btn-sm" onclick="window.addVariant()">+ Ajouter une variante</button>
        </div>
        
        <div id="foodFields" style="display:${product?.type === 'food' ? 'block' : 'none'};">
            <div class="form-row">
                <div class="form-group">
                    <label>Date d'expiration</label>
                    <input type="date" id="productExpiry" value="${product?.expiryDate || ''}">
                </div>
                <div class="form-group">
                    <label>Poids</label>
                    <input type="text" id="productWeight" value="${escapeHtml(product?.weight || '')}">
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Origine</label>
                    <input type="text" id="productOrigin" value="${escapeHtml(product?.origin || '')}">
                </div>
                <div class="form-group">
                    <label>Ingrédients</label>
                    <input type="text" id="productIngredients" value="${escapeHtml(product?.ingredients || '')}">
                </div>
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
    
    renderVariantsForm(tempVariants);
    renderProductPhotos(tempProductPhotos);
    
    const photoInput = document.getElementById('productPhotoInput');
    if (photoInput) {
        photoInput.addEventListener('change', handleProductPhotoUpload);
    }
}

function renderVariantsForm(variants) {
    const container = document.getElementById('variantsContainer');
    if (!container) return;
    
    if (variants.length === 0) {
        container.innerHTML = '<div style="padding:10px;color:var(--gray-500);">Aucune variante</div>';
        return;
    }
    
    container.innerHTML = variants.map((v, idx) => `
        <div class="variant-row">
            <input type="color" value="${v.color || '#1e40af'}" onchange="window.updateVariant(${idx}, 'color', this.value)">
            <input type="text" placeholder="Nom" value="${escapeHtml(v.name || '')}" onchange="window.updateVariant(${idx}, 'name', this.value)" style="width:100px;">
            <input type="number" placeholder="Prix" value="${v.price || ''}" onchange="window.updateVariant(${idx}, 'price', parseFloat(this.value))" style="width:90px;">
            <input type="number" placeholder="Stock" value="${v.stock || 0}" onchange="window.updateVariant(${idx}, 'stock', parseInt(this.value))" style="width:70px;">
            <button class="btn-danger" onclick="window.removeVariant(${idx})">✕</button>
        </div>
    `).join('');
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
    if (tempProductPhotos.length + files.length > 5) {
        alert("Maximum 5 photos");
        return;
    }
    
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

function addVariant() {
    tempVariants.push({ name: 'Nouvelle couleur', color: '#1e40af', price: 0, stock: 0 });
    renderVariantsForm(tempVariants);
}

function updateVariant(idx, field, value) {
    if (tempVariants[idx]) tempVariants[idx][field] = value;
}

function removeVariant(idx) {
    tempVariants.splice(idx, 1);
    renderVariantsForm(tempVariants);
}

function toggleProductFields() {
    const foodFields = document.getElementById('foodFields');
    const productType = document.getElementById('productType');
    if (foodFields && productType) {
        foodFields.style.display = productType.value === 'food' ? 'block' : 'none';
    }
}

function saveProduct() {
    const type = document.getElementById('productType').value;
    const name = document.getElementById('productName').value.trim();
    const categoryId = parseInt(document.getElementById('productCategory').value);
    const basePrice = parseFloat(document.getElementById('productBasePrice').value);
    const stock = parseInt(document.getElementById('productStock').value);
    const description = document.getElementById('productDesc').value;
    
    if (!name) { alert("Nom requis"); return; }
    if (!categoryId) { alert("Catégorie requise"); return; }
    if (isNaN(basePrice) || basePrice <= 0) { alert("Prix valide requis"); return; }
    
    const variants = tempVariants.filter(v => v.name && v.price > 0);
    const photos = tempProductPhotos;
    
    const productData = {
        id: editingProductId || Date.now(),
        type, name, categoryId, basePrice, stock, description, variants, photos,
        createdAt: new Date().toISOString()
    };
    
    if (type === 'food') {
        productData.expiryDate = document.getElementById('productExpiry')?.value || '';
        productData.weight = document.getElementById('productWeight')?.value || '';
        productData.origin = document.getElementById('productOrigin')?.value || '';
        productData.ingredients = document.getElementById('productIngredients')?.value || '';
    }
    
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
                    Catégorie: ${category?.name || 'Sans catégorie'} | ${p.variants?.length || 0} variante(s)
                </div>
                ${p.photos?.length ? `
                    <div class="photo-gallery">
                        ${p.photos.slice(0, 3).map(photo => `
                            <div class="photo-item" style="width:40px;height:40px;">
                                <img src="${photo}">
                            </div>
                        `).join('')}
                    </div>
                ` : ''}
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

function editProduct(id) {
    openAddProductModal(id);
}

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

// ============ LOGO UPLOAD ============
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
    
    const menuPosition = designConfig.menuPosition;
    const isVertical = menuPosition === 'vertical-left' || menuPosition === 'vertical-right';
    const floatDir = menuPosition === 'vertical-left' ? 'left' : 'right';
    
    let menuHtml = '';
    if (isVertical) {
        menuHtml = `<div class="preview-menu preview-menu-vertical" style="background:${designConfig.menuBg}; color:${designConfig.menuText}; border-radius:${designConfig.menuRadius}px; float:${floatDir}; width:160px; margin-${floatDir === 'left' ? 'right' : 'left'}:16px;">
            ${categories.map(cat => `<div class="preview-menu-item">${escapeHtml(cat.name)}</div>`).join('')}
        </div>`;
    } else {
        menuHtml = `<div class="preview-menu preview-menu-horizontal" style="background:${designConfig.menuBg}; color:${designConfig.menuText}; border-radius:${designConfig.menuRadius}px;">
            ${categories.map(cat => `<span style="padding:6px 12px;">${escapeHtml(cat.name)}</span>`).join('')}
        </div>`;
    }
    
    const contentMargin = menuPosition === 'vertical-left' ? 'margin-left: 176px;' : (menuPosition === 'vertical-right' ? 'margin-right: 176px;' : '');
    
    preview.innerHTML = `
        <style>
            .preview-shop{background:${bgColor}; border-radius:12px;}
            .preview-header{background:linear-gradient(135deg,${primaryColor},${primaryColor}aa);color:${headerTextColor};}
            .preview-product-title{color:${productTextColor};}
            .preview-product-price{color:${primaryColor};}
            .preview-btn{background:${buttonColor}; border-radius:${designConfig.prodRadius}px;}
            .preview-products{display:${designConfig.layout === 'grid' ? 'grid' : 'flex'}; ${designConfig.layout === 'grid' ? `grid-template-columns:repeat(auto-fill,minmax(${designConfig.prodWidth}px,1fr));` : 'flex-direction:column;'} gap:${designConfig.prodGap}px;}
            .preview-product{border-radius:${designConfig.prodRadius}px;}
            .preview-product-image{height:${designConfig.prodImgHeight}px;}
            .preview-carousel{height:${designConfig.carouselHeight}px; border-radius:${designConfig.carouselRadius}px;}
        </style>
        <div class="preview-shop">
            <div class="preview-header">
                <div class="preview-logo">
                    <div class="preview-logo-img">
                        ${tempLogo ? `<img src="${tempLogo}" style="width:100%;height:100%;object-fit:contain;">` : '<i class="fas fa-store" style="font-size:28px;"></i>'}
                    </div>
                    <div>
                        <h3 style="font-size:16px;">${escapeHtml(shopName)}</h3>
                        <p style="font-size:11px;">${escapeHtml(desc)}</p>
                        <div style="font-size:10px;"><i class="fas fa-map-marker-alt"></i> ${escapeHtml(city)} ${escapeHtml(quartier)}</div>
                    </div>
                </div>
            </div>
            ${menuHtml}
            <div class="preview-content" style="padding:16px; ${contentMargin}">
                <div class="preview-carousel" id="previewCarousel">
                    ${carouselMedia.map((m, i) => `
                        ${m.type === 'image' 
                            ? `<img src="${m.src}" class="slide ${i === 0 ? 'active' : ''}" style="width:100%; height:100%; object-fit:cover;">`
                            : `<video src="${m.src}" class="slide ${i === 0 ? 'active' : ''}" muted autoplay loop playsinline style="width:100%; height:100%; object-fit:cover;"></video>`
                        }
                    `).join('')}
                    ${carouselMedia.length > 1 ? `
                        <button class="carousel-btn carousel-prev" onclick="window.changeSlide(-1)">❮</button>
                        <button class="carousel-btn carousel-next" onclick="window.changeSlide(1)">❯</button>
                    ` : ''}
                </div>
                <div class="preview-products ${designConfig.layout === 'grid' ? 'grid' : 'list'}">
                    ${products.slice(0, 6).map(p => {
                        const minPrice = p.variants?.length ? Math.min(...p.variants.map(v => v.price), p.basePrice) : p.basePrice;
                        const maxPrice = p.variants?.length ? Math.max(...p.variants.map(v => v.price)) : p.basePrice;
                        return `
                            <div class="preview-product">
                                <div class="preview-product-image">
                                    ${p.photos?.[0] ? `<img src="${p.photos[0]}" loading="lazy">` : '<i class="fas fa-image" style="font-size:32px;color:#ccc;"></i>'}
                                </div>
                                <div class="preview-product-info">
                                    ${p.type === 'food' ? '<div class="food-badge"><i class="fas fa-utensils"></i> Alimentaire</div>' : ''}
                                    <div class="preview-product-title">${escapeHtml(p.name)}</div>
                                    ${p.variants?.length ? 
                                        `<div class="preview-product-price">${formatNumber(minPrice)} - ${formatNumber(maxPrice)} FCFA</div>` : 
                                        `<div class="preview-product-price">${formatNumber(p.basePrice)} FCFA</div>`
                                    }
                                    ${p.variants?.length ? `
                                        <div class="preview-product-colors">
                                            ${p.variants.slice(0, 3).map(v => `<div class="preview-color-dot" style="background:${v.color};" title="${escapeHtml(v.name)}"></div>`).join('')}
                                        </div>
                                    ` : ''}
                                    <button class="preview-btn">Ajouter</button>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
                ${!products.length ? '<div style="text-align:center;padding:40px;">Aucun produit</div>' : ''}
            </div>
        </div>
    `;
    
    if (carouselInterval) clearInterval(carouselInterval);
    if (carouselMedia.length > 1 && designConfig.carouselSpeed > 0) {
        carouselInterval = setInterval(() => {
            const slides = document.querySelectorAll('#previewCarousel .slide');
            if (!slides.length) return;
            let active = Array.from(slides).findIndex(s => s.classList.contains('active'));
            if (active !== -1) {
                slides[active].classList.remove('active');
                slides[(active + 1) % slides.length].classList.add('active');
            }
        }, designConfig.carouselSpeed * 1000);
    }
}

function changeSlide(d) {
    const slides = document.querySelectorAll('#previewCarousel .slide');
    if (!slides.length) return;
    let active = Array.from(slides).findIndex(s => s.classList.contains('active'));
    if (active !== -1) {
        slides[active].classList.remove('active');
        slides[(active + d + slides.length) % slides.length].classList.add('active');
    }
}

// ============ MISE À JOUR DES CONFIGURATIONS ============
function updateCarouselHeight(v) {
    designConfig.carouselHeight = v;
    document.getElementById('carouselHeightVal').innerText = v;
    debouncedUpdatePreview();
}

function updateCarouselRadius(v) {
    designConfig.carouselRadius = v;
    document.getElementById('carouselRadiusVal').innerText = v;
    debouncedUpdatePreview();
}

function updateMenuRadius(v) {
    designConfig.menuRadius = v;
    document.getElementById('menuRadiusVal').innerText = v;
    debouncedUpdatePreview();
}

function updateProdWidth(v) {
    designConfig.prodWidth = v;
    document.getElementById('prodWidthVal').innerText = v;
    debouncedUpdatePreview();
}

function updateProdImgHeight(v) {
    designConfig.prodImgHeight = v;
    document.getElementById('prodImgHeightVal').innerText = v;
    debouncedUpdatePreview();
}

function updateProdRadius(v) {
    designConfig.prodRadius = v;
    document.getElementById('prodRadiusVal').innerText = v;
    debouncedUpdatePreview();
}

function updateProdGap(v) {
    designConfig.prodGap = v;
    document.getElementById('prodGapVal').innerText = v;
    debouncedUpdatePreview();
}

// ============ PUBLICATION / MISE À JOUR ============
function publishShop() {
    const name = document.getElementById('shopNameInput').value.trim();
    if (!name) { alert("Nom de boutique requis"); return; }
    if (categories.length === 0) { alert("Créez au moins une catégorie"); return; }
    if (products.length === 0) { alert("Ajoutez au moins un produit"); return; }
    
    let shops = JSON.parse(localStorage.getItem('ouenze_shops') || '[]');
    let nextId = shops.length > 0 ? Math.max(...shops.map(s => s.id)) + 1 : 1;
    
    const newShop = {
        id: nextId,
        name,
        logo: tempLogo,
        description: document.getElementById('shopDescInput').value,
        city: document.getElementById('shopCity').value,
        quartier: document.getElementById('shopQuartier').value,
        address: document.getElementById('shopAddress')?.value || '',
        categories: categories.map(c => c.name),
        products: products,
        carousel: carouselMedia,
        menu: {
            position: designConfig.menuPosition,
            bg: designConfig.menuBg,
            text: designConfig.menuText,
            radius: designConfig.menuRadius
        },
        design: {
            primary: document.getElementById('primaryColor').value,
            button: document.getElementById('buttonColor').value,
            background: document.getElementById('bgColor').value,
            headerTextColor: document.getElementById('headerTextColor').value,
            productTextColor: document.getElementById('productTextColor').value,
            carouselHeight: designConfig.carouselHeight,
            carouselRadius: designConfig.carouselRadius,
            carouselSpeed: designConfig.carouselSpeed,
            prodWidth: designConfig.prodWidth,
            prodImgHeight: designConfig.prodImgHeight,
            prodRadius: designConfig.prodRadius,
            prodGap: designConfig.prodGap,
            layout: designConfig.layout
        },
        owner: currentUserEmail,
        verified: false,
        totalSales: 0,
        rating: 0,
        reviews: [],
        createdAt: new Date().toISOString()
    };
    
    shops.push(newShop);
    localStorage.setItem('ouenze_shops', JSON.stringify(shops));
    alert(`Boutique "${name}" créée !`);
    window.location.href = 'vendor-dashboard.html';
}

function updateShop() {
    if (!editingShopId) { alert("Erreur"); return; }
    const name = document.getElementById('shopNameInput').value.trim();
    if (!name) { alert("Nom requis"); return; }
    
    let shops = JSON.parse(localStorage.getItem('ouenze_shops') || '[]');
    const shopIndex = shops.findIndex(s => s.id == editingShopId);
    if (shopIndex === -1) { alert("Boutique non trouvée"); return; }
    
    shops[shopIndex] = {
        ...shops[shopIndex],
        name,
        logo: tempLogo,
        description: document.getElementById('shopDescInput').value,
        city: document.getElementById('shopCity').value,
        quartier: document.getElementById('shopQuartier').value,
        address: document.getElementById('shopAddress')?.value || '',
        categories: categories.map(c => c.name),
        products: products,
        carousel: carouselMedia,
        menu: {
            position: designConfig.menuPosition,
            bg: designConfig.menuBg,
            text: designConfig.menuText,
            radius: designConfig.menuRadius
        },
        design: {
            primary: document.getElementById('primaryColor').value,
            button: document.getElementById('buttonColor').value,
            background: document.getElementById('bgColor').value,
            headerTextColor: document.getElementById('headerTextColor').value,
            productTextColor: document.getElementById('productTextColor').value,
            carouselHeight: designConfig.carouselHeight,
            carouselRadius: designConfig.carouselRadius,
            carouselSpeed: designConfig.carouselSpeed,
            prodWidth: designConfig.prodWidth,
            prodImgHeight: designConfig.prodImgHeight,
            prodRadius: designConfig.prodRadius,
            prodGap: designConfig.prodGap,
            layout: designConfig.layout
        },
        updatedAt: new Date().toISOString()
    };
    
    localStorage.setItem('ouenze_shops', JSON.stringify(shops));
    alert(`Boutique "${name}" mise à jour !`);
    window.location.href = 'vendor-dashboard.html';
}

// ============ CHARGEMENT D'UNE BOUTIQUE EXISTANTE ============
function loadShopForEditing(shopId) {
    const shops = JSON.parse(localStorage.getItem('ouenze_shops') || '[]');
    const shop = shops.find(s => s.id == shopId);
    if (!shop) { alert("Boutique non trouvée"); return false; }
    if (shop.owner !== currentUserEmail && shop.ownerEmail !== currentUserEmail) {
        alert("Vous n'êtes pas autorisé");
        return false;
    }
    
    editingShopId = shopId;
    document.getElementById('shopNameInput').value = shop.name || '';
    document.getElementById('shopDescInput').value = shop.description || '';
    document.getElementById('shopCity').value = shop.city || '';
    document.getElementById('shopQuartier').value = shop.quartier || '';
    if (document.getElementById('shopAddress')) {
        document.getElementById('shopAddress').value = shop.address || '';
    }
    
    if (shop.logo) {
        tempLogo = shop.logo;
        document.getElementById('logoPreview').innerHTML = `<img src="${shop.logo}" style="width:100%;height:100%;object-fit:contain;">`;
    }
    
    categories = shop.categories?.map(c => ({ id: Date.now() + Math.random(), name: c })) || [];
    products = shop.products ? [...shop.products] : [];
    carouselMedia = shop.carousel ? [...shop.carousel] : [];
    
    if (shop.menu) {
        designConfig.menuPosition = shop.menu.position || 'horizontal';
        designConfig.menuBg = shop.menu.bg || '#1e40af';
        designConfig.menuText = shop.menu.text || '#ffffff';
        designConfig.menuRadius = shop.menu.radius || 0;
        document.getElementById('menuBgColor').value = designConfig.menuBg;
        document.getElementById('menuTextColor').value = designConfig.menuText;
        document.getElementById('menuRadius').value = designConfig.menuRadius;
        document.getElementById('menuRadiusVal').innerText = designConfig.menuRadius;
        
        document.querySelectorAll('.menu-pos-card').forEach(c => {
            c.classList.toggle('selected', c.dataset.pos === designConfig.menuPosition);
        });
    }
    
    if (shop.design) {
        document.getElementById('primaryColor').value = shop.design.primary || '#1e40af';
        document.getElementById('buttonColor').value = shop.design.button || '#1e40af';
        document.getElementById('bgColor').value = shop.design.background || '#ffffff';
        document.getElementById('headerTextColor').value = shop.design.headerTextColor || '#ffffff';
        document.getElementById('productTextColor').value = shop.design.productTextColor || '#1e293b';
        designConfig.carouselHeight = shop.design.carouselHeight || 300;
        designConfig.carouselRadius = shop.design.carouselRadius || 12;
        designConfig.carouselSpeed = shop.design.carouselSpeed || 0;
        designConfig.prodWidth = shop.design.prodWidth || 200;
        designConfig.prodImgHeight = shop.design.prodImgHeight || 160;
        designConfig.prodRadius = shop.design.prodRadius || 12;
        designConfig.prodGap = shop.design.prodGap || 16;
        designConfig.layout = shop.design.layout || 'grid';
        
        document.getElementById('carouselHeight').value = designConfig.carouselHeight;
        document.getElementById('carouselHeightVal').innerText = designConfig.carouselHeight;
        document.getElementById('carouselRadius').value = designConfig.carouselRadius;
        document.getElementById('carouselRadiusVal').innerText = designConfig.carouselRadius;
        document.getElementById('prodWidth').value = designConfig.prodWidth;
        document.getElementById('prodWidthVal').innerText = designConfig.prodWidth;
        document.getElementById('prodImgHeight').value = designConfig.prodImgHeight;
        document.getElementById('prodImgHeightVal').innerText = designConfig.prodImgHeight;
        document.getElementById('prodRadius').value = designConfig.prodRadius;
        document.getElementById('prodRadiusVal').innerText = designConfig.prodRadius;
        document.getElementById('prodGap').value = designConfig.prodGap;
        document.getElementById('prodGapVal').innerText = designConfig.prodGap;
        
        document.querySelectorAll('.layout-card').forEach(c => {
            c.classList.toggle('selected', c.dataset.layout === designConfig.layout);
        });
        document.querySelectorAll('.speed-card').forEach(c => {
            c.classList.toggle('selected', parseInt(c.dataset.speed) === designConfig.carouselSpeed);
        });
    }
    
    renderCarouselList();
    renderCategories();
    renderProductsList();
    document.getElementById('pageTitle').innerText = `Modification : ${shop.name}`;
    document.getElementById('publishBtn').style.display = 'none';
    document.getElementById('updateBtn').style.display = 'block';
    debouncedUpdatePreview();
    return true;
}

// ============ ÉCOUTEURS ============
function setupEventListeners() {
    // Inputs texte
    const inputs = ['primaryColor', 'buttonColor', 'bgColor', 'headerTextColor', 'productTextColor',
                    'shopNameInput', 'shopDescInput', 'shopCity', 'shopQuartier', 'shopAddress'];
    inputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', debouncedUpdatePreview);
    });
    
    // Menu
    const menuBg = document.getElementById('menuBgColor');
    if (menuBg) menuBg.addEventListener('input', (e) => { designConfig.menuBg = e.target.value; debouncedUpdatePreview(); });
    
    const menuText = document.getElementById('menuTextColor');
    if (menuText) menuText.addEventListener('input', (e) => { designConfig.menuText = e.target.value; debouncedUpdatePreview(); });
    
    // Position menu
    document.querySelectorAll('.menu-pos-card').forEach(card => {
        card.addEventListener('click', () => {
            designConfig.menuPosition = card.dataset.pos;
            document.querySelectorAll('.menu-pos-card').forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
            debouncedUpdatePreview();
        });
    });
    
    // Vitesse carrousel
    document.querySelectorAll('.speed-card').forEach(card => {
        card.addEventListener('click', () => {
            designConfig.carouselSpeed = parseInt(card.dataset.speed);
            document.querySelectorAll('.speed-card').forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
            debouncedUpdatePreview();
        });
    });
    
    // Layout produits
    document.querySelectorAll('.layout-card').forEach(card => {
        card.addEventListener('click', () => {
            designConfig.layout = card.dataset.layout;
            document.querySelectorAll('.layout-card').forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
            debouncedUpdatePreview();
        });
    });
    
    // Sliders
    const menuRadiusSlider = document.getElementById('menuRadius');
    if (menuRadiusSlider) menuRadiusSlider.addEventListener('input', (e) => updateMenuRadius(parseInt(e.target.value)));
    
    const carouselHeightSlider = document.getElementById('carouselHeight');
    if (carouselHeightSlider) carouselHeightSlider.addEventListener('input', (e) => updateCarouselHeight(parseInt(e.target.value)));
    
    const carouselRadiusSlider = document.getElementById('carouselRadius');
    if (carouselRadiusSlider) carouselRadiusSlider.addEventListener('input', (e) => updateCarouselRadius(parseInt(e.target.value)));
    
    const prodWidthSlider = document.getElementById('prodWidth');
    if (prodWidthSlider) prodWidthSlider.addEventListener('input', (e) => updateProdWidth(parseInt(e.target.value)));
    
    const prodImgHeightSlider = document.getElementById('prodImgHeight');
    if (prodImgHeightSlider) prodImgHeightSlider.addEventListener('input', (e) => updateProdImgHeight(parseInt(e.target.value)));
    
    const prodRadiusSlider = document.getElementById('prodRadius');
    if (prodRadiusSlider) prodRadiusSlider.addEventListener('input', (e) => updateProdRadius(parseInt(e.target.value)));
    
    const prodGapSlider = document.getElementById('prodGap');
    if (prodGapSlider) prodGapSlider.addEventListener('input', (e) => updateProdGap(parseInt(e.target.value)));
}

// ============ INITIALISATION ============
function init() {
    // Récupérer l'utilisateur courant
    currentUser = JSON.parse(localStorage.getItem('ouenze_current_user') || 'null');
    currentUserEmail = currentUser?.email || 'vendeur@ouenze.cg';
    
    // Récupérer l'ID de la boutique à éditer
    const urlParams = new URLSearchParams(window.location.search);
    const editShopIdParam = urlParams.get('edit');
    
    setupLogoUpload();
    setupCarouselUpload();
    setupEventListeners();
    
    if (editShopIdParam) {
        loadShopForEditing(editShopIdParam);
    } else {
        renderCategories();
        renderProductsList();
    }
    
    debouncedUpdatePreview();
}

// Nettoyage au déchargement
window.addEventListener('beforeunload', () => {
    if (carouselInterval) clearInterval(carouselInterval);
});

// Exports globaux
window.addCategory = addCategory;
window.removeCategory = removeCategory;
window.updateCategoryName = updateCategoryName;
window.openAddProductModal = openAddProductModal;
window.editProduct = editProduct;
window.deleteProduct = deleteProduct;
window.closeProductModal = closeProductModal;
window.saveProduct = saveProduct;
window.updateProductField = updateProductField;
window.addVariant = addVariant;
window.updateVariant = updateVariant;
window.removeVariant = removeVariant;
window.toggleProductFields = toggleProductFields;
window.removeCarouselMedia = removeCarouselMedia;
window.publishShop = publishShop;
window.updateShop = updateShop;
window.changeSlide = changeSlide;
window.removeProductPhoto = removeProductPhoto;

// Démarrer l'application
init();