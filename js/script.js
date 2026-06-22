// ============ CONSTANTES ============
const DEFAULT_LAT = -4.2634;
const DEFAULT_LNG = 15.2429;

// ============ VARIABLES DE TRI ============
let currentSortBy = 'rating';
let currentSortOrder = 'desc';
let currentProductType = 'all';

// ============ LISTE DES PAYS AVEC VILLES ============
const countries = [
    { code: "CG", flag: "🇨🇬", name: "Congo-Brazzaville", phoneCode: "+242", cities: ["Brazzaville", "Pointe-Noire", "Dolisie", "Nkayi", "Madingou", "Ouesso", "Impfondo", "Sibiti", "Oyo", "Mossendjo"] },
    { code: "CD", flag: "🇨🇩", name: "Congo-RD", phoneCode: "+243", cities: ["Kinshasa", "Lubumbashi", "Mbuji-Mayi", "Kisangani", "Kananga", "Goma", "Bukavu", "Kolwezi", "Likasi", "Tshikapa"] },
    { code: "CI", flag: "🇨🇮", name: "Côte d'Ivoire", phoneCode: "+225", cities: ["Abidjan", "Bouaké", "Daloa", "Yamoussoukro", "San-Pédro", "Korhogo", "Man", "Gagnoa", "Anyama", "Abobo"] },
    { code: "CM", flag: "🇨🇲", name: "Cameroun", phoneCode: "+237", cities: ["Douala", "Yaoundé", "Garoua", "Bamenda", "Maroua", "Nkongsamba", "Bafoussam", "Bertoua", "Edea", "Loum"] },
    { code: "BF", flag: "🇧🇫", name: "Burkina Faso", phoneCode: "+226", cities: ["Ouagadougou", "Bobo-Dioulasso", "Koudougou", "Banfora", "Ouahigouya", "Dédougou", "Kaya", "Fada N'Gourma", "Tenkodogo"] },
    { code: "GN", flag: "🇬🇳", name: "Guinée", phoneCode: "+224", cities: ["Conakry", "Nzérékoré", "Kankan", "Kindia", "Labé", "Guéckédou", "Mamou", "Boké", "Faranah", "Kissidougou"] },
    { code: "ML", flag: "🇲🇱", name: "Mali", phoneCode: "+223", cities: ["Bamako", "Sikasso", "Mopti", "Koutiala", "Ségou", "Kayes", "Markala", "Kolondiéba", "San", "Bougouni"] },
    { code: "SN", flag: "🇸🇳", name: "Sénégal", phoneCode: "+221", cities: ["Dakar", "Touba", "Thiès", "Mbour", "Kaolack", "Ziguinchor", "Saint-Louis", "Diourbel", "Tambacounda", "Rufisque"] },
    { code: "TG", flag: "🇹🇬", name: "Togo", phoneCode: "+228", cities: ["Lomé", "Sokodé", "Kara", "Atakpamé", "Palimé", "Bassar", "Tsévié", "Aného", "Mango", "Dapaong"] },
    { code: "BJ", flag: "🇧🇯", name: "Bénin", phoneCode: "+229", cities: ["Cotonou", "Porto-Novo", "Parakou", "Djougou", "Bohicon", "Abomey", "Natitingou", "Lokossa", "Ouidah", "Kandi"] },
    { code: "NE", flag: "🇳🇪", name: "Niger", phoneCode: "+227", cities: ["Niamey", "Zinder", "Maradi", "Agadez", "Tahoua", "Dosso", "Birni N'Konni", "Diffa", "Gaya", "Magaria"] },
    { code: "GA", flag: "🇬🇦", name: "Gabon", phoneCode: "+241", cities: ["Libreville", "Port-Gentil", "Franceville", "Oyem", "Moanda", "Mouila", "Lambaréné", "Tchibanga", "Koulamoutou", "Makokou"] },
    { code: "CF", flag: "🇨🇫", name: "Centrafrique", phoneCode: "+236", cities: ["Bangui", "Bimbo", "Berbérati", "Carnot", "Bambari", "Bouar", "Bossangoa", "Bria", "Nola", "Kaga-Bandoro"] },
    { code: "TD", flag: "🇹🇩", name: "Tchad", phoneCode: "+235", cities: ["N'Djaména", "Moundou", "Sarh", "Abéché", "Kelo", "Pala", "Am Timan", "Bongor", "Mongo", "Doba"] },
    { code: "MA", flag: "🇲🇦", name: "Maroc", phoneCode: "+212", cities: ["Casablanca", "Rabat", "Fès", "Tanger", "Marrakech", "Agadir", "Meknès", "Oujda", "Kenitra", "Tétouan"] },
    { code: "DZ", flag: "🇩🇿", name: "Algérie", phoneCode: "+213", cities: ["Alger", "Oran", "Constantine", "Annaba", "Blida", "Sétif", "Djelfa", "Sidi Bel Abbès", "Biskra", "Tébessa"] },
    { code: "TN", flag: "🇹🇳", name: "Tunisie", phoneCode: "+216", cities: ["Tunis", "Sfax", "Sousse", "Ettadhamen", "Kairouan", "Bizerte", "Gabès", "Ariana", "Gafsa", "La Goulette"] },
    { code: "GW", flag: "🇬🇼", name: "Guinée-Bissau", phoneCode: "+245", cities: ["Bissau", "Bafatá", "Gabú", "Bissorã", "Bolama", "Cacheu", "Canchungo", "Farim", "Quinhámel", "Mansôa"] }
];

// ============ DONNEES ============
let currentUser = JSON.parse(localStorage.getItem('ouenze_current_user') || 'null');
let shops = JSON.parse(localStorage.getItem('ouenze_shops') || '[]');
let orders = JSON.parse(localStorage.getItem('ouenze_orders') || '[]');
let cart = JSON.parse(localStorage.getItem('ouenze_cart') || '[]');
let currentRanking = 'rating';
let currentShop = null;
let currentCategory = 'all';
let selectedPayment = null;
let currentLocationMap = null;
let currentLocationMarker = null;
let tempDeliveryLocation = null;
let currentStep = 1;
let tempUserData = {};
let generatedCode = "";
let currentProfileTab = 'info';

// Initialisation des données si vides
if (shops.length === 0) {
    shops = [{ 
        id: 1, name: "Elegance Africaine", city: "Brazzaville", quartier: "Moungali", rating: 5.0, totalRatings: 342, totalSales: 1250,
        products: [{ id: 1, name: "Boubou Ceremonie", price: "65000", photos: [], stock: 25, description: "Boubou traditionnel" }],
        categories: ["Boubou"], reviews: [{ user: "Marie K.", userEmail: "marie@email.com", rating: 5, comment: "Superbe qualite !", date: "2024-03-15" }],
        verified: true, location: { lat: -4.2634, lng: 15.2429, country: "CG", address: "Moungali", deliveryZones: [{ country: "CG", city: "Brazzaville" }] },
        ownerEmail: "vendeur@example.com", ownerName: "Vendeur Example"
    }];
    localStorage.setItem('ouenze_shops', JSON.stringify(shops));
}

// ============ FONCTIONS UTILITAIRES ============
function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
}

function saveData() {
    localStorage.setItem('ouenze_shops', JSON.stringify(shops));
    localStorage.setItem('ouenze_orders', JSON.stringify(orders));
    localStorage.setItem('ouenze_cart', JSON.stringify(cart));
    if (currentUser) localStorage.setItem('ouenze_current_user', JSON.stringify(currentUser));
    else localStorage.removeItem('ouenze_current_user');
    updateCartCount();
    updateVendorLink();
}

function updateCartCount() {
    const count = cart.reduce((s, i) => s + i.quantity, 0);
    document.querySelectorAll('#cartCountHeader, .cart-count').forEach(el => { if(el) el.innerText = count; });
}

function updateVendorLink() {
    const vendorLink = document.getElementById('vendorLink');
    const deliveryDashboardLink = document.getElementById('deliveryDashboardLink');
    if (currentUser && currentUser.type === 'vendeur') vendorLink.style.display = 'inline-block';
    else vendorLink.style.display = 'none';
    if (currentUser && currentUser.type === 'livreur') deliveryDashboardLink.style.display = 'inline-block';
    else deliveryDashboardLink.style.display = 'none';
}

function generateStars(rating) {
    let stars = '';
    for (let i = 0; i < Math.floor(rating); i++) stars += '<i class="fas fa-star"></i>';
    if (rating % 1 >= 0.5) stars += '<i class="fas fa-star-half-alt"></i>';
    for (let i = 0; i < 5 - Math.ceil(rating); i++) stars += '<i class="far fa-star"></i>';
    return stars;
}

function sendEmail(to, subject, body) { 
    console.log(`Email to ${to}: ${subject}\n${body}`); 
    return true; 
}

function validateEmail(email) { 
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); 
}

function validatePhoneIntuitive(phone, countryCode) {
    let clean = phone.replace(/\D/g, '');
    const phoneRules = {
        "+212": /^(0?[5-7])[0-9]{8}$/, "+213": /^(0?[5-7])[0-9]{8}$/, "+216": /^[2-9][0-9]{7}$/,
        "+223": /^[6-9][0-9]{7}$/, "+224": /^[0-9]{9}$/, "+225": /^[0-9]{10}$/, "+226": /^[0-9]{8}$/,
        "+237": /^[6-9][0-9]{8}$/, "+241": /^[0-9]{8}$/, "+242": /^(0?[45-6])[0-9]{7}$/, "+243": /^[0-9]{9}$/,
        "+245": /^[0-9]{9}$/, "+221": /^[7-8][0-9]{8}$/, "+228": /^[0-9]{8}$/, "+229": /^[0-9]{8}$/,
        "+227": /^[0-9]{8}$/, "+236": /^[0-9]{8}$/, "+235": /^[0-9]{8}$/
    };
    if (phoneRules[countryCode]) return phoneRules[countryCode].test(clean);
    return clean.length >= 8 && clean.length <= 12;
}

function formatPhoneForDisplay(phone) {
    let clean = phone.replace(/\s/g, '');
    if (!clean.startsWith('0') && clean.length <= 9) clean = '0' + clean;
    return clean;
}

function sendNotification(contact, method, subject, message) {
    if (method === 'email') {
        console.log(`📧 EMAIL -> ${contact}: ${subject}\n${message}`);
        return true;
    } else if (method === 'sms') {
        console.log(`📱 SMS -> ${contact}: ${message}`);
        return true;
    } else if (method === 'whatsapp') {
        console.log(`💬 WhatsApp -> ${contact}: ${message}`);
        return true;
    }
    return false;
}

// ============ FONCTIONS GÉOGRAPHIQUES ============
function canDeliverToLocation(shop, countryCode, city) {
    if (!shop.location) return false;
    if (shop.location.deliveryZones && shop.location.deliveryZones.length > 0) {
        return shop.location.deliveryZones.some(zone => 
            zone.country === countryCode && 
            (zone.city === city || zone.city === 'all')
        );
    }
    return shop.location.country === countryCode;
}

function canCombineShopsDelivery(shopsList, countryCode, city) {
    const incompatibleShops = shopsList.filter(shop => 
        !canDeliverToLocation(shop, countryCode, city)
    );
    if (incompatibleShops.length > 0) {
        return { possible: false, incompatibleShops: incompatibleShops, message: `❌ Les boutiques suivantes ne livrent pas dans votre région : ${incompatibleShops.map(s => s.name).join(', ')}` };
    }
    return { possible: true };
}

function updateCities() {
    const countrySelect = document.getElementById('deliveryCountry');
    const citySelect = document.getElementById('deliveryCity');
    if (!countrySelect || !citySelect) return;
    const selectedCountry = countries.find(c => c.code === countrySelect.value);
    if (selectedCountry) {
        citySelect.innerHTML = selectedCountry.cities.map(city => `<option value="${city}">${city}</option>`).join('');
    }
}

// ============ FONCTIONS DE NOTATION ============
function canUserRateShop(userEmail, shopId) {
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const userOrders = orders.filter(o => 
        o.userId === userEmail && 
        o.items.some(i => i.shopId === shopId) &&
        new Date(o.date) > oneYearAgo
    );
    return userOrders.length > 0;
}

function addShopRating(shopId, rating, comment, userEmail, userName) {
    const shop = shops.find(s => s.id === shopId);
    if (!shop) return false;
    if (!canUserRateShop(userEmail, shopId)) {
        alert("Vous ne pouvez noter que les boutiques où vous avez acheté dans l'année écoulée.");
        return false;
    }
    const existingReview = shop.reviews.find(r => r.userEmail === userEmail);
    if (existingReview) {
        existingReview.rating = rating;
        existingReview.comment = comment;
        existingReview.date = new Date().toISOString();
    } else {
        shop.reviews.push({
            user: userName,
            userEmail: userEmail,
            rating: rating,
            comment: comment,
            date: new Date().toISOString()
        });
    }
    const totalRating = shop.reviews.reduce((sum, r) => sum + r.rating, 0);
    shop.rating = totalRating / shop.reviews.length;
    shop.totalRatings = shop.reviews.length;
    localStorage.setItem('ouenze_shops', JSON.stringify(shops));
    return true;
}

function canRateDelivery(orderId, userEmail) {
    const order = orders.find(o => o.id === orderId);
    if (!order || order.userId !== userEmail) return false;
    const deliveryDate = new Date(order.deliveryDate || order.date);
    const now = new Date();
    const hoursDiff = (now - deliveryDate) / (1000 * 60 * 60);
    return hoursDiff <= 48 && order.status === 'delivered';
}

function addDeliveryRating(orderId, rating, comment) {
    const order = orders.find(o => o.id === orderId);
    if (!order) return false;
    if (!canRateDelivery(orderId, currentUser.email)) {
        alert("Vous ne pouvez noter le livreur que dans les 48h suivant la livraison.");
        return false;
    }
    if (!order.deliveryRating) {
        order.deliveryRating = { rating, comment, date: new Date().toISOString() };
        localStorage.setItem('ouenze_orders', JSON.stringify(orders));
        return true;
    }
    return false;
}

// ============ FONCTIONS DE TRI ET FILTRES ============
function sortShops(shopsList, sortBy, order = 'desc') {
    return [...shopsList].sort((a, b) => {
        let valueA, valueB;
        
        switch(sortBy) {
            case 'rating':
                valueA = a.rating || 0;
                valueB = b.rating || 0;
                break;
            case 'price':
                const avgPriceA = a.products && a.products.length ? 
                    a.products.reduce((sum, p) => sum + parseFloat(p.price || 0), 0) / a.products.length : 0;
                const avgPriceB = b.products && b.products.length ? 
                    b.products.reduce((sum, p) => sum + parseFloat(p.price || 0), 0) / b.products.length : 0;
                valueA = avgPriceA;
                valueB = avgPriceB;
                break;
            case 'sales':
                valueA = a.totalSales || 0;
                valueB = b.totalSales || 0;
                break;
            case 'name':
                valueA = a.name || '';
                valueB = b.name || '';
                if (order === 'asc') {
                    return valueA.localeCompare(valueB);
                } else {
                    return valueB.localeCompare(valueA);
                }
            default:
                valueA = a.rating || 0;
                valueB = b.rating || 0;
        }
        
        if (order === 'asc') {
            return valueA - valueB;
        } else {
            return valueB - valueA;
        }
    });
}

function setSort(sortBy) {
    if (currentSortBy === sortBy) {
        currentSortOrder = currentSortOrder === 'desc' ? 'asc' : 'desc';
    } else {
        currentSortBy = sortBy;
        currentSortOrder = 'desc';
    }
    
    document.querySelectorAll('.sort-btn').forEach(btn => {
        if (btn.dataset.sort === sortBy) {
            btn.classList.add('active');
            const icon = btn.querySelector('i');
            if (icon) {
                icon.className = currentSortOrder === 'desc' ? 'fas fa-sort-down' : 'fas fa-sort-up';
            }
        } else {
            btn.classList.remove('active');
            const icon = btn.querySelector('i');
            if (icon) icon.className = 'fas fa-sort';
        }
    });
    
    const query = document.getElementById('searchInput')?.value.toLowerCase().trim() || '';
    if (query) {
        performSearch();
    } else {
        const shopsToShow = filterShopsByProductType([...shops], currentProductType);
        const rankedShops = sortShops(shopsToShow, currentSortBy, currentSortOrder);
        displayShops(rankedShops);
    }
}

function filterShopsByProductType(shopsList, productType) {
    if (productType === 'all') return shopsList;
    
    return shopsList.filter(shop => {
        if (!shop.products || shop.products.length === 0) return false;
        
        if (productType === 'food') {
            return shop.products.some(p => p.productType === 'food' || p.category === 'Alimentation');
        } else if (productType === 'other') {
            return shop.products.some(p => p.productType !== 'food' && p.category !== 'Alimentation');
        }
        return true;
    });
}

function filterProductsByType(productsList, productType) {
    if (productType === 'all') return productsList;
    
    return productsList.filter(product => {
        if (productType === 'food') {
            return product.productType === 'food' || product.category === 'Alimentation';
        } else if (productType === 'other') {
            return product.productType !== 'food' && product.category !== 'Alimentation';
        }
        return true;
    });
}

function filterByProductType(type) {
    currentProductType = type;
    
    document.querySelectorAll('.product-type-btn').forEach(btn => {
        if (btn.dataset.type === type) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
    
    const query = document.getElementById('searchInput')?.value.toLowerCase().trim() || '';
    if (query) {
        performSearch();
    } else {
        const filteredShops = filterShopsByProductType([...shops], type);
        const sortedShops = sortShops(filteredShops, currentSortBy, currentSortOrder);
        displayShops(sortedShops);
        const productsGrid = document.getElementById('productsGrid');
        const shopsGrid = document.getElementById('shopsGrid');
        if (productsGrid) productsGrid.style.display = 'none';
        if (shopsGrid) shopsGrid.style.display = 'grid';
    }
}

function getShopLevel(shop) {
    const rating = shop.rating || 0;
    if (rating >= 4.5) return { level: 'gold', name: 'Or' };
    if (rating >= 4) return { level: 'silver', name: 'Argent' };
    if (rating >= 3) return { level: 'bronze', name: 'Bronze' };
    return { level: null, name: 'Standard' };
}

function displayShops(shopsList) {
    const grid = document.getElementById('shopsGrid');
    if (!grid) return;
    
    if (!shopsList.length) {
        grid.innerHTML = '<div style="text-align:center;padding:60px;color:var(--gray-500);"><i class="fas fa-store-slash" style="font-size:48px;margin-bottom:16px;"></i><p>Aucune boutique trouvée</p></div>';
        return;
    }
    
    grid.innerHTML = shopsList.map(shop => {
        const level = getShopLevel(shop);
        const levelClass = level.level === 'gold' ? 'gold' : level.level === 'silver' ? 'silver' : 'bronze';
        const avgPrice = shop.products && shop.products.length ? 
            Math.round(shop.products.reduce((sum, p) => sum + parseFloat(p.price || 0), 0) / shop.products.length) : 0;
        
        return `
            <div class="shop-card" onclick="viewShopDetail(${shop.id})">
                <div class="shop-logo-area">
                    <div class="shop-logo-img">${shop.logo ? `<img src="${shop.logo}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">` : '<i class="fas fa-store" style="font-size:28px;"></i>'}</div>
                    <div class="shop-name">${escapeHtml(shop.name)}</div>
                    <div class="shop-rating"><div class="stars">${generateStars(shop.rating || 0)}</div><span>(${shop.totalRatings || 0})</span></div>
                    <div class="shop-price" style="font-size:14px;font-weight:600;color:var(--primary);margin:5px 0;">
                        À partir de ${avgPrice.toLocaleString()} FCFA
                    </div>
                    <div style="font-size:11px;color:var(--gray-500);margin-top:4px;">
                        <i class="fas fa-map-marker-alt"></i> ${escapeHtml(shop.city || 'Brazzaville')}${shop.quartier ? `, ${escapeHtml(shop.quartier)}` : ''}
                    </div>
                    <div style="margin-top:6px;">
                        <span class="level-badge level-${levelClass}" style="font-size:10px;padding:2px 8px;">
                            <i class="fas fa-crown"></i> ${level.name || 'Standard'}
                        </span>
                        <span style="font-size:10px;margin-left:6px;">
                            <i class="fas fa-chart-line"></i> ${shop.totalSales || 0} ventes
                        </span>
                    </div>
                </div>
                <div class="shop-details">
                    <div class="shop-metrics">
                        <div class="metric">
                            <div class="metric-value">${shop.products?.length || 0}</div>
                            <div>Produits</div>
                        </div>
                        <div class="metric">
                            <div class="metric-value">${shop.totalSales || 0}</div>
                            <div>Ventes</div>
                        </div>
                    </div>
                    <button class="btn-visit-shop">
                        <i class="fas fa-eye"></i> Voir la boutique
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

function displayProducts(productsList) {
    const grid = document.getElementById('productsGrid');
    if (!grid) return;
    
    if (!productsList.length) {
        grid.innerHTML = '<div style="text-align:center;padding:60px;color:var(--gray-500);"><i class="fas fa-box-open" style="font-size:48px;margin-bottom:16px;"></i><p>Aucun produit trouvé</p></div>';
        return;
    }
    
    grid.innerHTML = productsList.map(product => `
        <div class="product-card" onclick="openProductModal(${product.shopId}, ${product.id})">
            <img src="${product.photos?.[0] || 'https://via.placeholder.com/300x200'}" class="product-image">
            <div class="product-info">
                <div class="product-title">${escapeHtml(product.name)}</div>
                <div class="product-price">${product.price} FCFA</div>
                <div style="font-size:11px;color:var(--gray-500);margin:4px 0;">
                    <i class="fas fa-store"></i> ${escapeHtml(product.shopName)}
                    ${product.shopCity ? ` • <i class="fas fa-map-marker-alt"></i> ${escapeHtml(product.shopCity)}` : ''}
                </div>
                ${product.shopRating ? `<div style="font-size:10px;color:var(--gold);">${generateStars(product.shopRating)}</div>` : ''}
                <button class="btn-add-cart" onclick="event.stopPropagation();addToCart(${product.shopId}, ${product.id}, '${escapeHtml(product.name)}', '${product.price}')">Ajouter</button>
            </div>
        </div>
    `).join('');
}

function performSearch() {
    const query = document.getElementById('searchInput').value.toLowerCase().trim();
    
    if (!query) {
        let shopsToShow = filterShopsByProductType([...shops], currentProductType);
        const rankedShops = sortShops(shopsToShow, currentSortBy, currentSortOrder);
        displayShops(rankedShops);
        const productsGrid = document.getElementById('productsGrid');
        const shopsGrid = document.getElementById('shopsGrid');
        if (productsGrid) productsGrid.style.display = 'none';
        if (shopsGrid) shopsGrid.style.display = 'grid';
        const resultCount = document.getElementById('resultCount');
        if (resultCount) resultCount.innerHTML = '';
        return;
    }
    
    const searchType = window.currentSearchType || 'all';
    let filteredShops = [];
    let filteredProducts = [];
    
    if (searchType === 'shop' || searchType === 'all') {
        filteredShops = shops.filter(shop => 
            shop.name.toLowerCase().includes(query) ||
            (shop.city && shop.city.toLowerCase().includes(query)) ||
            (shop.quartier && shop.quartier.toLowerCase().includes(query)) ||
            (shop.description && shop.description.toLowerCase().includes(query))
        );
        filteredShops = filterShopsByProductType(filteredShops, currentProductType);
    }
    
    if (searchType === 'product' || searchType === 'all') {
        shops.forEach(shop => {
            (shop.products || []).forEach(product => {
                if (product.name.toLowerCase().includes(query) ||
                    (product.description && product.description.toLowerCase().includes(query))) {
                    filteredProducts.push({ 
                        ...product, 
                        shopId: shop.id, 
                        shopName: shop.name,
                        shopCity: shop.city,
                        shopRating: shop.rating
                    });
                }
            });
        });
        filteredProducts = filterProductsByType(filteredProducts, currentProductType);
    }
    
    const shopsGrid = document.getElementById('shopsGrid');
    const productsGrid = document.getElementById('productsGrid');
    
    if (searchType === 'shop') {
        const sortedShops = sortShops(filteredShops, currentSortBy, currentSortOrder);
        displayShops(sortedShops);
        if (productsGrid) productsGrid.style.display = 'none';
        if (shopsGrid) shopsGrid.style.display = 'grid';
    } 
    else if (searchType === 'product') {
        displayProducts(filteredProducts);
        if (productsGrid) productsGrid.style.display = 'grid';
        if (shopsGrid) shopsGrid.style.display = 'none';
    } 
    else {
        if (filteredShops.length > 0) {
            const sortedShops = sortShops(filteredShops, currentSortBy, currentSortOrder);
            displayShops(sortedShops);
            if (productsGrid) productsGrid.style.display = 'none';
            if (shopsGrid) shopsGrid.style.display = 'grid';
        } 
        else if (filteredProducts.length > 0) {
            displayProducts(filteredProducts);
            if (productsGrid) productsGrid.style.display = 'grid';
            if (shopsGrid) shopsGrid.style.display = 'none';
        } 
        else {
            displayShops([]);
            if (productsGrid) productsGrid.style.display = 'none';
            if (shopsGrid) shopsGrid.style.display = 'grid';
        }
    }
    
    const resultCount = document.getElementById('resultCount');
    if (resultCount) {
        const total = searchType === 'shop' ? filteredShops.length : 
                     searchType === 'product' ? filteredProducts.length : 
                     filteredShops.length + filteredProducts.length;
        resultCount.innerHTML = `${total} résultat(s) trouvé(s)`;
    }
}

// ============ PAGE ACCUEIL ============
function showHomePage() {
    const shopsToShow = filterShopsByProductType([...shops], currentProductType);
    const rankedShops = sortShops(shopsToShow, currentSortBy, currentSortOrder);
    document.getElementById('appContainer').innerHTML = `
        <div class="ranking-bar">
            <div class="ranking-filters">
                <button class="sort-btn ${currentSortBy === 'rating' ? 'active' : ''}" data-sort="rating" onclick="setSort('rating')">
                    <i class="fas ${currentSortBy === 'rating' ? (currentSortOrder === 'desc' ? 'fa-sort-down' : 'fa-sort-up') : 'fa-sort'}"></i> Par note
                </button>
                <button class="sort-btn ${currentSortBy === 'price' ? 'active' : ''}" data-sort="price" onclick="setSort('price')">
                    <i class="fas ${currentSortBy === 'price' ? (currentSortOrder === 'desc' ? 'fa-sort-down' : 'fa-sort-up') : 'fa-sort'}"></i> Par prix
                </button>
                <button class="sort-btn ${currentSortBy === 'sales' ? 'active' : ''}" data-sort="sales" onclick="setSort('sales')">
                    <i class="fas ${currentSortBy === 'sales' ? (currentSortOrder === 'desc' ? 'fa-sort-down' : 'fa-sort-up') : 'fa-sort'}"></i> Par ventes
                </button>
                <button class="sort-btn ${currentSortBy === 'name' ? 'active' : ''}" data-sort="name" onclick="setSort('name')">
                    <i class="fas ${currentSortBy === 'name' ? (currentSortOrder === 'desc' ? 'fa-sort-down' : 'fa-sort-up') : 'fa-sort'}"></i> Par nom
                </button>
            </div>
            <div style="display:flex; gap:6px;">
                <span class="rating-badge gold"><i class="fas fa-crown"></i> Or</span>
                <span class="rating-badge silver"><i class="fas fa-star"></i> Argent</span>
                <span class="rating-badge bronze"><i class="fas fa-star-half-alt"></i> Bronze</span>
            </div>
        </div>
        
        <div class="product-type-filters">
            <button class="product-type-btn ${currentProductType === 'all' ? 'active' : ''}" data-type="all" onclick="filterByProductType('all')">
                <i class="fas fa-th-large"></i> Tous les produits
            </button>
            <button class="product-type-btn ${currentProductType === 'food' ? 'active' : ''}" data-type="food" onclick="filterByProductType('food')">
                <i class="fas fa-utensils"></i> Alimentation
            </button>
            <button class="product-type-btn ${currentProductType === 'other' ? 'active' : ''}" data-type="other" onclick="filterByProductType('other')">
                <i class="fas fa-box"></i> Autres produits
            </button>
        </div>
        
        <div id="resultCount" style="margin-bottom:16px; font-size:12px; color:var(--gray-500);"></div>
        <div id="shopsGrid" class="shops-grid"></div>
        <div id="productsGrid" class="products-grid" style="display:none;"></div>
    `;
    
    displayShops(rankedShops);
    
    window.currentSearchType = 'all';
    document.querySelectorAll('.search-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.search-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            window.currentSearchType = tab.dataset.type;
            performSearch();
        });
    });
}

function resetToHome() { 
    showHomePage(); 
}

// ============ VUE BOUTIQUE ============
function viewShopDetail(shopId) {
    const shop = shops.find(s => s.id === shopId);
    if (!shop) return;
    currentShop = shop;
    currentCategory = 'all';
    
    const canRate = currentUser ? canUserRateShop(currentUser.email, shopId) : false;
    const countryName = countries.find(c => c.code === shop.location?.country)?.name || shop.location?.country || 'Congo-Brazzaville';
    
    document.getElementById('appContainer').innerHTML = `
        <button class="back-btn" onclick="resetToHome()"><i class="fas fa-arrow-left"></i> Retour</button>
        <div class="shop-header-custom">
            <div class="shop-header-content">
                <div class="shop-logo-large">${shop.logo ? `<img src="${shop.logo}" style="width:100%;height:100%;object-fit:cover;">` : '<i class="fas fa-store" style="font-size:28px;"></i>'}</div>
                <div class="shop-info">
                    <h1>${escapeHtml(shop.name)}</h1>
                    <div class="shop-rating"><div class="stars">${generateStars(shop.rating || 0)}</div><span>${shop.rating || 0} (${shop.totalRatings || 0} avis)</span></div>
                    <div><i class="fas fa-map-marker-alt"></i> ${escapeHtml(shop.address || shop.city)}, ${countryName}</div>
                    ${shop.location?.lat ? `<div style="font-size:11px;margin-top:4px;"><i class="fas fa-location-dot"></i> Position GPS disponible</div>` : ''}
                </div>
            </div>
        </div>
        <div class="categories-filter" id="shopCategoriesFilter">
            <button class="category-btn active" data-cat="all">Tous</button>
            ${(shop.categories || []).map(cat => `<button class="category-btn" data-cat="${escapeHtml(cat)}">${escapeHtml(cat)}</button>`).join('')}
        </div>
        <div id="shopProductsContainer" class="products-container"></div>
        <div class="reviews-section">
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; margin-bottom:15px;">
                <h3>Avis clients</h3>
                ${canRate ? `<button class="btn-sm" onclick="openRatingModal(${shop.id})" style="background:var(--primary);color:white;padding:5px 12px;border-radius:20px;border:none;cursor:pointer;">Noter cette boutique</button>` : ''}
            </div>
            ${(shop.reviews || []).length ? shop.reviews.map(r => `
                <div class="review-item">
                    <div><strong>${escapeHtml(r.user)}</strong> ${generateStars(r.rating)}</div>
                    <div style="font-size:12px; color:var(--gray-500);">${new Date(r.date).toLocaleDateString()}</div>
                    <div>${escapeHtml(r.comment)}</div>
                </div>
            `).join('') : '<p>Aucun avis</p>'}
        </div>
    `;
    displayShopProducts();
    document.querySelectorAll('#shopCategoriesFilter .category-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#shopCategoriesFilter .category-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentCategory = btn.dataset.cat;
            displayShopProducts();
        });
    });
}

function displayShopProducts() {
    const container = document.getElementById('shopProductsContainer');
    if (!container) return;
    let products = currentShop.products || [];
    if (currentCategory !== 'all') products = products.filter(p => p.category === currentCategory);
    if (!products.length) { container.innerHTML = '<div style="text-align:center;padding:30px;">Aucun produit</div>'; return; }
    container.innerHTML = products.map(p => `
        <div class="product-card" onclick="openProductModal(${currentShop.id}, ${p.id})">
            <img src="${p.photos?.[0] || 'https://via.placeholder.com/300x200'}" class="product-image">
            <div class="product-info">
                <div class="product-title">${escapeHtml(p.name)}</div>
                <div class="product-price">${p.price} FCFA</div>
                <button class="btn-add-cart" onclick="event.stopPropagation();addToCart(${currentShop.id}, ${p.id}, '${escapeHtml(p.name)}', '${p.price}')">Ajouter</button>
            </div>
        </div>
    `).join('');
}

function openProductModal(shopId, productId) {
    const shop = shops.find(s => s.id === shopId);
    const product = shop?.products?.find(p => p.id === productId);
    if (!product) return;
    const modal = document.createElement('div'); modal.className = 'modal active';
    modal.innerHTML = `
        <div class="modal-card">
            <button class="modal-close" onclick="this.closest('.modal').remove()">&times;</button>
            <h2 style="margin-bottom:15px;">${escapeHtml(product.name)}</h2>
            <div class="product-price" style="font-size:20px;">${product.price} FCFA</div>
            <div class="product-stock" style="margin:10px 0;">Stock: ${product.stock || 0}</div>
            <div>${escapeHtml(product.description || '')}</div>
            <button class="btn-submit" style="margin-top:20px;" onclick="addToCartFromModal(${shop.id}, ${product.id}, '${escapeHtml(product.name)}', '${product.price}')">Ajouter au panier</button>
            <button class="btn-cancel" onclick="this.closest('.modal').remove()">Fermer</button>
        </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
}

function addToCartFromModal(shopId, productId, productName, price) {
    if (!currentUser) { alert("Connectez-vous"); openLoginModal(); return; }
    addToCart(shopId, productId, productName, price);
    document.querySelector('.modal')?.remove();
}

function addToCart(shopId, productId, productName, price) {
    if (!currentUser) { alert("Connectez-vous"); openLoginModal(); return; }
    const existing = cart.find(i => i.productId === productId && i.shopId === shopId);
    if (existing) existing.quantity++;
    else cart.push({ productId, productName, price: parseFloat(price), quantity: 1, shopId, shopName: shops.find(s=>s.id===shopId)?.name });
    saveData();
    alert(`${productName} ajoute au panier`);
}

// ============ PANIER ============
function showCart() {
    if (cart.length === 0) {
        document.getElementById('appContainer').innerHTML = `<div class="cart-container" style="text-align:center;"><i class="fas fa-shopping-cart" style="font-size:48px;"></i><h3>Panier vide</h3><button onclick="resetToHome()" class="btn-submit">Continuer</button></div>`;
        return;
    }
    let subtotal = cart.reduce((s,i)=>s+i.price*i.quantity,0);
    let total = subtotal * 1.1;
    document.getElementById('appContainer').innerHTML = `
        <div class="cart-container"><h2>Mon panier</h2>
        ${cart.map((item, idx) => `<div class="cart-item"><div class="cart-item-info"><h4>${escapeHtml(item.productName)}</h4><div>${item.price} FCFA</div><div>${escapeHtml(item.shopName)}</div><div><button style="padding:2px 8px;margin:0 2px;" onclick="updateQuantity(${idx}, -1)">-</button> ${item.quantity} <button style="padding:2px 8px;margin:0 2px;" onclick="updateQuantity(${idx}, 1)">+</button> <button onclick="removeFromCart(${idx})" style="color:var(--danger);background:none;border:none;"><i class="fas fa-trash"></i></button></div></div></div>`).join('')}
        <div class="cart-total">Total: ${total.toLocaleString()} FCFA</div>
        <button class="btn-submit" onclick="showLocationSelection(${total})">Passer a la caisse</button>
        <button class="btn-cancel" onclick="resetToHome()">Continuer mes achats</button></div>`;
}

function updateQuantity(idx, delta) { 
    cart[idx].quantity += delta; 
    if (cart[idx].quantity <= 0) cart.splice(idx,1); 
    saveData(); 
    showCart(); 
}

function removeFromCart(idx) { 
    cart.splice(idx,1); 
    saveData(); 
    showCart(); 
}

// ============ LOCALISATION ET PAIEMENT ============
function showLocationSelection(total) {
    tempDeliveryLocation = null;
    const uniqueShopIds = [...new Set(cart.map(item => item.shopId))];
    const shopsInCart = uniqueShopIds.map(id => shops.find(s => s.id === id)).filter(s => s);
    
    document.getElementById('appContainer').innerHTML = `
        <div class="cart-container">
            <h2>Ou souhaitez-vous etre livre ?</h2>
            <div class="form-row">
                <div class="form-group"><label>Pays *</label>
                    <select id="deliveryCountry" onchange="updateCities()">${countries.map(c => `<option value="${c.code}" ${c.code === "CG" ? "selected" : ""}>${c.flag} ${c.name}</option>`).join('')}</select>
                </div>
                <div class="form-group"><label>Ville *</label><select id="deliveryCity"></select></div>
            </div>
            <div class="form-group"><label>Quartier</label><input type="text" id="deliveryQuartier" placeholder="Moungali"></div>
            <div class="form-group"><label>Adresse detaillee</label><input type="text" id="deliveryAddress" placeholder="Rue, numero, point de repere"></div>
            <div class="form-group"><label>Telephone</label>
                <div class="phone-input-group">
                    <select id="countryCodePhone">${countries.map(c => `<option value="${c.phoneCode}" ${c.phoneCode === "+242" ? "selected" : ""}>${c.flag} ${c.phoneCode}</option>`).join('')}</select>
                    <input type="tel" id="deliveryPhone" placeholder="06 123 4567">
                </div>
            </div>
            <div id="deliveryWarning" class="delivery-warning" style="display:none;"></div>
            <div class="location-map-container"><div id="deliveryLocationMap" class="location-map"></div></div>
            <div class="location-actions">
                <button onclick="getCurrentUserLocation()"><i class="fas fa-location-dot"></i> Ma position</button>
                <button onclick="searchAddressLocation()"><i class="fas fa-search"></i> Chercher une adresse</button>
                <button onclick="resetMapView()"><i class="fas fa-home"></i> Reinitialiser</button>
            </div>
            <div id="locationInfo" class="location-info"></div>
            <button class="btn-submit" onclick="goToPayment(${total})">Continuer vers paiement</button>
            <button class="btn-cancel" onclick="showCart()">Retour</button>
        </div>
    `;
    updateCities();
    
    const countrySelect = document.getElementById('deliveryCountry');
    const citySelect = document.getElementById('deliveryCity');
    const warningDiv = document.getElementById('deliveryWarning');
    
    function checkDeliveryCompatibility() {
        const country = countrySelect.value;
        const city = citySelect.value;
        const deliveryCheck = canCombineShopsDelivery(shopsInCart, country, city);
        if (warningDiv) {
            if (!deliveryCheck.possible) {
                warningDiv.style.display = 'flex';
                warningDiv.innerHTML = `<i class="fas fa-exclamation-triangle"></i> ${deliveryCheck.message}`;
            } else {
                warningDiv.style.display = 'none';
            }
        }
    }
    if (countrySelect) countrySelect.addEventListener('change', checkDeliveryCompatibility);
    if (citySelect) citySelect.addEventListener('change', checkDeliveryCompatibility);
    
    setTimeout(() => {
        if (currentLocationMap) currentLocationMap.remove();
        currentLocationMap = L.map('deliveryLocationMap').setView([DEFAULT_LAT, DEFAULT_LNG], 14);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { attribution: '&copy; OSM' }).addTo(currentLocationMap);
        currentLocationMarker = L.marker([DEFAULT_LAT, DEFAULT_LNG], { draggable: true }).addTo(currentLocationMap);
        currentLocationMarker.on('dragend', function(e) {
            const pos = e.target.getLatLng();
            tempDeliveryLocation = { lat: pos.lat, lng: pos.lng };
            document.getElementById('locationInfo').innerHTML = `Position selectionnee: ${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}`;
        });
        currentLocationMap.on('click', function(e) {
            currentLocationMarker.setLatLng(e.latlng);
            tempDeliveryLocation = { lat: e.latlng.lat, lng: e.latlng.lng };
            document.getElementById('locationInfo').innerHTML = `Position selectionnee: ${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}`;
        });
    }, 100);
}

function resetMapView() {
    if (currentLocationMap) currentLocationMap.flyTo([DEFAULT_LAT, DEFAULT_LNG], 14, { duration: 0.8 });
    if (currentLocationMarker) currentLocationMarker.setLatLng([DEFAULT_LAT, DEFAULT_LNG]);
    tempDeliveryLocation = { lat: DEFAULT_LAT, lng: DEFAULT_LNG };
    document.getElementById('locationInfo').innerHTML = `Vue reinitialisee sur Brazzaville`;
}

function getCurrentUserLocation() {
    if (!navigator.geolocation) { alert("Geolocalisation non supportee"); return; }
    document.getElementById('locationInfo').innerHTML = `<i class="fas fa-spinner fa-spin"></i> Recherche...`;
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            const lat = pos.coords.latitude, lng = pos.coords.longitude;
            if (currentLocationMarker) currentLocationMarker.setLatLng([lat, lng]);
            if (currentLocationMap) currentLocationMap.flyTo([lat, lng], 15, { duration: 1 });
            tempDeliveryLocation = { lat, lng };
            document.getElementById('locationInfo').innerHTML = `Position actuelle: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        },
        () => { document.getElementById('locationInfo').innerHTML = `Impossible d'obtenir votre position`; }
    );
}

function searchAddressLocation() {
    const address = prompt("Entrez votre adresse (ex: Moungali, Brazzaville)");
    if (!address) return;
    document.getElementById('locationInfo').innerHTML = `<i class="fas fa-spinner fa-spin"></i> Recherche...`;
    fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`, {
        headers: { 'User-Agent': 'OuenzeMarketplace/1.0' }
    }).then(r => r.json()).then(data => {
        if (data && data.length > 0) {
            const lat = parseFloat(data[0].lat), lng = parseFloat(data[0].lon);
            if (currentLocationMarker) currentLocationMarker.setLatLng([lat, lng]);
            if (currentLocationMap) currentLocationMap.flyTo([lat, lng], 16, { duration: 1 });
            tempDeliveryLocation = { lat, lng };
            document.getElementById('locationInfo').innerHTML = `Adresse trouvee: ${data[0].display_name.substring(0, 80)}`;
        } else { document.getElementById('locationInfo').innerHTML = `Adresse non trouvee`; }
    }).catch(() => { document.getElementById('locationInfo').innerHTML = `Erreur de recherche`; });
}

function goToPayment(total) {
    if (!tempDeliveryLocation) { alert("Veuillez selectionner votre position sur la carte"); return; }
    const country = document.getElementById('deliveryCountry')?.value;
    const city = document.getElementById('deliveryCity')?.value;
    const quartier = document.getElementById('deliveryQuartier')?.value.trim() || '';
    const address = document.getElementById('deliveryAddress')?.value.trim() || '';
    const phoneCode = document.getElementById('countryCodePhone')?.value;
    const phone = document.getElementById('deliveryPhone')?.value.trim();
    if (!country || !city) { alert("Veuillez selectionner votre pays et ville"); return; }
    if (!phone) { alert("Veuillez entrer votre numero de telephone"); return; }
    if (!validatePhoneIntuitive(phone, phoneCode)) { alert("Numero invalide"); return; }
    
    const uniqueShopIds = [...new Set(cart.map(item => item.shopId))];
    const shopsInCart = uniqueShopIds.map(id => shops.find(s => s.id === id)).filter(s => s);
    const deliveryCheck = canCombineShopsDelivery(shopsInCart, country, city);
    if (!deliveryCheck.possible) { alert(deliveryCheck.message); return; }
    
    window.tempDeliveryInfo = { country, city, quartier, address, phone: `${phoneCode} ${formatPhoneForDisplay(phone)}`, location: tempDeliveryLocation };
    showPaymentSelection(total);
}

function showPaymentSelection(total) {
    selectedPayment = null;
    document.getElementById('appContainer').innerHTML = `
        <div class="cart-container">
            <h2>Mode de paiement</h2>
            <div class="payment-options" id="paymentOptions">
                <div class="payment-option" data-payment="card"><i class="fas fa-credit-card"></i> Carte bancaire</div>
                <div class="payment-option" data-payment="mtn"><i class="fas fa-mobile-alt"></i> MTN Mobile Money</div>
                <div class="payment-option" data-payment="airtel"><i class="fas fa-mobile-alt"></i> Airtel Money</div>
                <div class="payment-option" data-payment="orange"><i class="fas fa-mobile-alt" style="color:#ff6600;"></i> Orange Money</div>
                <div class="payment-option" data-payment="cash"><i class="fas fa-money-bill"></i> Espece</div>
            </div>
            <div id="paymentDetailsContainer" style="display:none;"></div>
            <div class="cart-total">Total: ${total.toLocaleString()} FCFA</div>
            <button class="btn-submit" onclick="validateOrder(${total})">Confirmer</button>
            <button class="btn-cancel" onclick="showLocationSelection(${total})">Retour</button>
        </div>
    `;
    document.querySelectorAll('.payment-option').forEach(opt => {
        opt.addEventListener('click', () => {
            document.querySelectorAll('.payment-option').forEach(o => o.classList.remove('selected'));
            opt.classList.add('selected');
            selectedPayment = opt.dataset.payment;
            const container = document.getElementById('paymentDetailsContainer');
            if (container) {
                container.style.display = 'block';
                container.innerHTML = `<div class="card-details"><p>Paiement par ${opt.innerText}</p><div class="info-text">Vous serez redirige apres confirmation</div></div>`;
            }
        });
    });
}

function validateOrder(total) {
    if (!selectedPayment) { alert("Choisissez un mode de paiement"); return; }
    const orderId = crypto.randomUUID();
    const subtotal = cart.reduce((s,i)=>s+i.price*i.quantity,0);
    const newOrder = {
        id: orderId, userId: currentUser?.email, userName: currentUser?.name,
        items: cart.map(i => ({ productId: i.productId, productName: i.productName, price: i.price, quantity: i.quantity, shopId: i.shopId, shopName: i.shopName, vendorEmail: shops.find(s => s.id === i.shopId)?.ownerEmail })),
        subtotal, deliveryFees: subtotal * 0.1, total: subtotal * 1.1,
        deliveryInfo: { ...window.tempDeliveryInfo }, paymentMethod: selectedPayment,
        date: new Date().toISOString(), status: 'confirmee', deliveryMan: null, deliveryManName: null, deliveryDate: null,
        notificationMethod: null
    };
    orders.push(newOrder);
    localStorage.setItem('ouenze_orders', JSON.stringify(orders));
    cart = [];
    saveData();
    alert(`Commande ${orderId} confirmee ! Total: ${newOrder.total.toLocaleString()} FCFA\n\nVous pouvez modifier votre mode de paiement dans "Mes commandes".`);
    resetToHome();
}

// ============ COMMANDES ============
function showMyOrders() {
    const userOrders = orders.filter(o => o.userId === currentUser?.email);
    if (userOrders.length === 0) {
        document.getElementById('appContainer').innerHTML = `<div class="cart-container"><h3>Aucune commande</h3><button onclick="resetToHome()" class="btn-submit">Retour</button></div>`;
        return;
    }
    document.getElementById('appContainer').innerHTML = `
        <div class="cart-container"><h2>Mes commandes</h2>
        ${userOrders.map(order => `
            <div style="border:1px solid var(--gray-200);border-radius:12px;padding:12px;margin-bottom:12px;">
                <div style="display:flex;justify-content:space-between;flex-wrap:wrap;"><strong>${order.id}</strong><span>${new Date(order.date).toLocaleDateString()}</span></div>
                <div>Total: ${order.total.toLocaleString()} FCFA</div>
                <div>Paiement: ${order.paymentMethod || 'Non défini'}</div>
                <div>Statut: <span style="color:var(--success);">${order.status}</span></div>
                <div class="order-actions" style="margin-top:8px; display:flex; gap:8px; flex-wrap:wrap;">
                    <button class="btn-sm" onclick="trackOrder('${order.id}')" style="padding:4px 12px;border-radius:20px;border:1px solid var(--gray-200);background:var(--gray-100);cursor:pointer;">Suivre</button>
                    <button class="btn-sm" onclick="openChangePaymentModal('${order.id}')" style="padding:4px 12px;border-radius:20px;border:none;background:var(--warning);color:white;cursor:pointer;">Modifier le paiement</button>
                    ${order.status === 'delivered' && !order.deliveryRating && canRateDelivery(order.id, currentUser.email) ? 
                        `<button class="btn-sm" style="padding:4px 12px;border-radius:20px;border:none;background:var(--primary);color:white;cursor:pointer;" onclick="openDeliveryRatingModal('${order.id}')">Noter le livreur</button>` : ''}
                </div>
            </div>
        `).join('')}
        <button onclick="resetToHome()" class="btn-cancel">Continuer</button></div>`;
}

function trackOrder(orderId) {
    const order = orders.find(o => o.id === orderId);
    if (!order || !order.deliveryInfo?.location) { alert("Aucune position GPS disponible"); return; }
    window.open(`https://www.google.com/maps?q=${order.deliveryInfo.location.lat},${order.deliveryInfo.location.lng}`, '_blank');
}

function openChangePaymentModal(orderId) {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;
    
    const modal = document.createElement('div'); modal.className = 'modal active';
    modal.innerHTML = `
        <div class="modal-card">
            <button class="modal-close" onclick="this.closest('.modal').remove()">&times;</button>
            <h3>Modifier le mode de paiement</h3>
            <div class="form-group"><label>Nouveau mode de paiement</label>
                <select id="newPaymentMethod">
                    <option value="card" ${order.paymentMethod === 'card' ? 'selected' : ''}>Carte bancaire</option>
                    <option value="mtn" ${order.paymentMethod === 'mtn' ? 'selected' : ''}>MTN Mobile Money</option>
                    <option value="airtel" ${order.paymentMethod === 'airtel' ? 'selected' : ''}>Airtel Money</option>
                    <option value="orange" ${order.paymentMethod === 'orange' ? 'selected' : ''}>Orange Money</option>
                    <option value="cash" ${order.paymentMethod === 'cash' ? 'selected' : ''}>Espèce</option>
                </select>
            </div>
            <button class="btn-submit" onclick="updatePaymentMethod('${orderId}')">Modifier</button>
        </div>
    `;
    document.body.appendChild(modal);
    
    window.updatePaymentMethod = (id) => {
        const newMethod = document.getElementById('newPaymentMethod').value;
        const orderIndex = orders.findIndex(o => o.id === id);
        if (orderIndex !== -1) {
            orders[orderIndex].paymentMethod = newMethod;
            localStorage.setItem('ouenze_orders', JSON.stringify(orders));
            alert(`Mode de paiement modifié : ${newMethod}`);
            modal.remove();
            showMyOrders();
        }
    };
}

function openDeliveryRatingModal(orderId) {
    const modal = document.createElement('div'); modal.className = 'modal active';
    modal.innerHTML = `
        <div class="modal-card rating-modal">
            <button class="modal-close" onclick="this.closest('.modal').remove()">&times;</button>
            <h3>Noter le livreur</h3>
            <div class="rating-stars" id="deliveryRatingStars">
                ${[1,2,3,4,5].map(i => `<i class="far fa-star rating-star" data-rating="${i}"></i>`).join('')}
            </div>
            <div class="form-group"><textarea id="deliveryComment" rows="3" placeholder="Votre commentaire sur le livreur (optionnel)"></textarea></div>
            <div class="rating-warning">⚠️ Vous avez 48h après la livraison pour noter le livreur.</div>
            <button class="btn-submit" onclick="submitDeliveryRating('${orderId}')">Envoyer ma note</button>
        </div>
    `;
    document.body.appendChild(modal);
    
    let selectedRating = 0;
    document.querySelectorAll('#deliveryRatingStars .rating-star').forEach(star => {
        star.addEventListener('click', () => {
            selectedRating = parseInt(star.dataset.rating);
            document.querySelectorAll('#deliveryRatingStars .rating-star').forEach(s => {
                const rating = parseInt(s.dataset.rating);
                if (rating <= selectedRating) s.className = 'fas fa-star rating-star active';
                else s.className = 'far fa-star rating-star';
            });
        });
    });
    
    window.submitDeliveryRating = (id) => {
        if (selectedRating === 0) { alert("Veuillez sélectionner une note"); return; }
        const comment = document.getElementById('deliveryComment')?.value || '';
        if (addDeliveryRating(id, selectedRating, comment)) {
            alert("Merci pour votre évaluation !");
            modal.remove();
            showMyOrders();
        }
    };
}

function openRatingModal(shopId) {
    const modal = document.createElement('div'); modal.className = 'modal active';
    modal.innerHTML = `
        <div class="modal-card rating-modal">
            <button class="modal-close" onclick="this.closest('.modal').remove()">&times;</button>
            <h3>Noter la boutique</h3>
            <div class="rating-stars" id="ratingStars">
                ${[1,2,3,4,5].map(i => `<i class="far fa-star rating-star" data-rating="${i}"></i>`).join('')}
            </div>
            <div class="form-group"><textarea id="ratingComment" rows="3" placeholder="Votre commentaire (optionnel)"></textarea></div>
            <button class="btn-submit" onclick="submitRating(${shopId})">Envoyer ma note</button>
        </div>
    `;
    document.body.appendChild(modal);
    
    let selectedRating = 0;
    document.querySelectorAll('.rating-star').forEach(star => {
        star.addEventListener('click', () => {
            selectedRating = parseInt(star.dataset.rating);
            document.querySelectorAll('.rating-star').forEach(s => {
                const rating = parseInt(s.dataset.rating);
                if (rating <= selectedRating) s.className = 'fas fa-star rating-star active';
                else s.className = 'far fa-star rating-star';
            });
        });
    });
    
    window.submitRating = (id) => {
        if (selectedRating === 0) { alert("Veuillez sélectionner une note"); return; }
        const comment = document.getElementById('ratingComment')?.value || '';
        if (addShopRating(id, selectedRating, comment, currentUser.email, currentUser.name)) {
            alert("Merci pour votre avis !");
            modal.remove();
            viewShopDetail(id);
        }
    };
}

// ============ LIVREUR ============
function showDeliveryDashboard() {
    if (!currentUser || currentUser.type !== 'livreur') { alert("Espace reserve aux livreurs"); return; }
    const pendingOrders = orders.filter(o => o.status === 'confirmee');
    if (pendingOrders.length === 0) {
        document.getElementById('appContainer').innerHTML = `<div class="cart-container"><h3>Aucune commande a livrer</h3><button onclick="resetToHome()" class="btn-submit">Retour</button></div>`;
        return;
    }
    document.getElementById('appContainer').innerHTML = `
        <div class="cart-container"><h2>Commandes a livrer</h2>
        ${pendingOrders.map(order => `
            <div style="border:1px solid var(--gray-200);border-radius:12px;padding:12px;margin-bottom:12px;">
                <strong>${order.id}</strong><br>Client: ${order.userName}<br>Pays: ${order.deliveryInfo?.country}<br>Ville: ${order.deliveryInfo?.city}<br>Adresse: ${order.deliveryInfo?.address}<br>Total: ${order.total.toLocaleString()} FCFA
                <div class="form-group" style="margin-top:8px;"><label>Mode de notification</label>
                    <select id="notifMethod_${order.id}">
                        <option value="email">Email</option>
                        <option value="sms">SMS</option>
                        <option value="whatsapp">WhatsApp</option>
                    </select>
                </div>
                <div class="form-group"><label>Contact</label><input type="text" id="notifContact_${order.id}" placeholder="Email ou numéro de téléphone"></div>
                <button class="btn-submit" style="margin-top:8px;padding:6px;" onclick="acceptDeliveryOrder('${order.id}')">Accepter la livraison</button>
            </div>
        `).join('')}
        <button onclick="resetToHome()" class="btn-cancel">Retour</button></div>`;
}

function acceptDeliveryOrder(orderId) {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;
    
    const notifMethod = document.getElementById(`notifMethod_${orderId}`)?.value;
    const contact = document.getElementById(`notifContact_${orderId}`)?.value.trim();
    
    if (!contact) {
        alert("Veuillez renseigner un contact (email ou numéro) pour les notifications");
        return;
    }
    
    order.status = 'en_livraison';
    order.deliveryMan = currentUser.email;
    order.deliveryManName = currentUser.name;
    order.notificationMethod = notifMethod;
    order.deliveryContact = contact;
    
    localStorage.setItem('ouenze_orders', JSON.stringify(orders));
    
    const clientContact = order.deliveryInfo?.phone;
    if (clientContact) {
        sendNotification(clientContact, notifMethod, "Livraison en cours", `Votre commande ${orderId} est en cours de livraison par ${currentUser.name}.`);
    }
    
    if (order.deliveryInfo?.location) {
        window.open(`https://www.google.com/maps?q=${order.deliveryInfo.location.lat},${order.deliveryInfo.location.lng}`, '_blank');
    }
    
    alert(`Livraison ${orderId} acceptee !\n\nLes notifications seront envoyées par ${notifMethod}.\nClient: ${order.userName}\nAdresse: ${order.deliveryInfo?.address}`);
    showDeliveryDashboard();
}

function goToDeliveryDashboard() {
    if (!currentUser || currentUser.type !== 'livreur') { alert("Accès réservé aux livreurs"); return; }
    window.location.href = 'delivery-dashboard.html';
}

// ============ PROFIL ============
function showProfile() {
    if (!currentUser) { alert("Connectez-vous"); openLoginModal(); return; }
    
    const userData = getUserData();
    const docsStatus = getUserDocumentsStatus();
    
    document.getElementById('appContainer').innerHTML = `
        <div class="profile-container">
            <div class="profile-header">
                <div class="profile-avatar">
                    <img id="profileAvatarImg" src="${userData.profilePhoto || 'https://via.placeholder.com/100'}" class="profile-avatar-img" onerror="this.src='https://via.placeholder.com/100'">
                    <div class="edit-avatar-btn" onclick="editProfilePhoto()"><i class="fas fa-camera"></i></div>
                </div>
                <div class="profile-name">${escapeHtml(userData.fullName || currentUser.name)}</div>
                <div class="profile-email">${escapeHtml(currentUser.email)}</div>
                <div class="profile-badge">${currentUser.type === 'vendeur' ? 'Vendeur' : currentUser.type === 'livreur' ? 'Livreur' : 'Client'}</div>
            </div>
            <div class="profile-tabs">
                <div class="profile-tab ${currentProfileTab === 'info' ? 'active' : ''}" data-tab="info">Informations</div>
                <div class="profile-tab ${currentProfileTab === 'location' ? 'active' : ''}" data-tab="location">Localisation</div>
                ${currentUser.type === 'livreur' ? `<div class="profile-tab ${currentProfileTab === 'documents' ? 'active' : ''}" data-tab="documents">Documents</div>` : ''}
                <div class="profile-tab ${currentProfileTab === 'orders' ? 'active' : ''}" data-tab="orders">Commandes</div>
            </div>
            <div id="profileTabInfo" class="profile-section ${currentProfileTab === 'info' ? 'active' : ''}">
                <div class="info-card">
                    <div class="info-row"><div class="info-label">Nom complet</div><div class="info-value" id="displayFullName">${escapeHtml(userData.fullName || 'Non renseigné')}</div><div class="info-actions"><button class="edit-btn" onclick="editField('fullName')">Modifier</button></div></div>
                    <div class="info-row"><div class="info-label">Email</div><div class="info-value">${escapeHtml(currentUser.email)}</div></div>
                    <div class="info-row"><div class="info-label">Téléphone</div><div class="info-value" id="displayPhone">${escapeHtml(userData.phone || 'Non renseigné')}</div><div class="info-actions"><button class="edit-btn" onclick="editField('phone')">Modifier</button></div></div>
                    <div class="info-row"><div class="info-label">Statut du compte</div><div class="info-value"><span class="status-badge status-active">Actif</span></div></div>
                </div>
            </div>
            <div id="profileTabLocation" class="profile-section ${currentProfileTab === 'location' ? 'active' : ''}">
                <div class="info-card">
                    <div class="info-row"><div class="info-label">Pays</div><div class="info-value" id="displayCountry">${escapeHtml(userData.country || 'Congo-Brazzaville')}</div><div class="info-actions"><button class="edit-btn" onclick="editField('country')">Modifier</button></div></div>
                    <div class="info-row"><div class="info-label">Ville</div><div class="info-value" id="displayCity">${escapeHtml(userData.city || 'Brazzaville')}</div><div class="info-actions"><button class="edit-btn" onclick="editField('city')">Modifier</button></div></div>
                    <div class="info-row"><div class="info-label">Adresse</div><div class="info-value" id="displayAddress">${escapeHtml(userData.address || 'Non renseigné')}</div><div class="info-actions"><button class="edit-btn" onclick="editField('address')">Modifier</button></div></div>
                    <div class="location-map-container"><div id="profileLocationMap" class="location-map" style="height:250px;"></div></div>
                    <div class="location-actions" style="margin-top:10px;">
                        <button onclick="getProfileCurrentLocation()"><i class="fas fa-location-dot"></i> Ma position actuelle</button>
                        <button onclick="saveProfileLocation()"><i class="fas fa-save"></i> Enregistrer cette position</button>
                    </div>
                    <div id="profileLocationInfo" class="location-info"></div>
                </div>
            </div>
            ${currentUser.type === 'livreur' ? `
            <div id="profileTabDocuments" class="profile-section ${currentProfileTab === 'documents' ? 'active' : ''}">
                <div class="info-card">
                    <h4>Documents obligatoires</h4>
                    <div class="info-row"><div class="info-label">Pièce d'identité</div><div class="info-value">${docsStatus.idCard ? '✓ Document fourni' : '❌ Non fourni'}</div><div class="info-actions"><button class="edit-btn" onclick="uploadDocument('idCard')">${docsStatus.idCard ? 'Mettre à jour' : 'Ajouter'}</button></div></div>
                    <div class="info-row"><div class="info-label">Permis de conduire</div><div class="info-value">${docsStatus.drivingLicense ? '✓ Document fourni' : '❌ Non fourni'}</div><div class="info-actions"><button class="edit-btn" onclick="uploadDocument('drivingLicense')">${docsStatus.drivingLicense ? 'Mettre à jour' : 'Ajouter'}</button></div></div>
                    <div class="info-row"><div class="info-label">Matricule véhicule</div><div class="info-value" id="displayVehiclePlate">${escapeHtml(userData.vehiclePlate || 'Non renseigné')}</div><div class="info-actions"><button class="edit-btn" onclick="editField('vehiclePlate')">Modifier</button></div></div>
                    <div class="info-row"><div class="info-label">Type de véhicule</div><div class="info-value" id="displayVehicleType">${escapeHtml(userData.vehicleType || 'Non renseigné')}</div><div class="info-actions"><button class="edit-btn" onclick="editField('vehicleType')">Modifier</button></div></div>
                    <div class="info-row"><div class="info-label">Photo du véhicule</div><div class="info-value">${docsStatus.vehiclePhoto ? '✓ Photo fournie' : '❌ Non fournie'}</div><div class="info-actions"><button class="edit-btn" onclick="uploadDocument('vehiclePhoto')">${docsStatus.vehiclePhoto ? 'Mettre à jour' : 'Ajouter'}</button></div></div>
                    <div class="info-text" style="margin-top:10px;">⚠️ Les documents doivent être mis à jour chaque trimestre.</div>
                </div>
            </div>
            ` : ''}
            <div id="profileTabOrders" class="profile-section ${currentProfileTab === 'orders' ? 'active' : ''}">
                <div id="profileOrdersList" class="commandes-list"></div>
            </div>
            <button onclick="logout()" class="btn-submit" style="margin-top:20px;">Se déconnecter</button>
        </div>
    `;
    
    renderProfileOrders();
    attachProfileTabs();
    initProfileLocationMap(userData);
}

function getUserData() {
    const allUsers = JSON.parse(localStorage.getItem('ouenze_all_users') || '[]');
    const user = allUsers.find(u => u.email === currentUser?.email);
    return user || {};
}

function getUserDocumentsStatus() {
    const userData = getUserData();
    return {
        idCard: !!userData.idCard,
        drivingLicense: !!userData.drivingLicense,
        vehiclePhoto: !!userData.vehiclePhoto,
        lastUpdate: userData.documentsLastUpdate || null
    };
}

function initProfileLocationMap(userData) {
    const lat = userData.locationLat || DEFAULT_LAT;
    const lng = userData.locationLng || DEFAULT_LNG;
    const mapContainer = document.getElementById('profileLocationMap');
    if (!mapContainer) return;
    
    setTimeout(() => {
        if (window.profileMap) window.profileMap.remove();
        window.profileMap = L.map('profileLocationMap').setView([lat, lng], 14);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { attribution: '&copy; OSM' }).addTo(window.profileMap);
        window.profileMarker = L.marker([lat, lng], { draggable: true }).addTo(window.profileMap);
        window.profileMarker.on('dragend', function(e) {
            const pos = e.target.getLatLng();
            window.tempProfileLocation = { lat: pos.lat, lng: pos.lng };
            document.getElementById('profileLocationInfo').innerHTML = `Position sélectionnée: ${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}`;
        });
        window.profileMap.on('click', function(e) {
            window.profileMarker.setLatLng(e.latlng);
            window.tempProfileLocation = { lat: e.latlng.lat, lng: e.latlng.lng };
            document.getElementById('profileLocationInfo').innerHTML = `Position sélectionnée: ${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}`;
        });
    }, 100);
}

function getProfileCurrentLocation() {
    if (!navigator.geolocation) { alert("Géolocalisation non supportée"); return; }
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            const lat = pos.coords.latitude, lng = pos.coords.longitude;
            if (window.profileMarker) window.profileMarker.setLatLng([lat, lng]);
            if (window.profileMap) window.profileMap.setView([lat, lng], 15);
            window.tempProfileLocation = { lat, lng };
            document.getElementById('profileLocationInfo').innerHTML = `Position actuelle: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        },
        () => { document.getElementById('profileLocationInfo').innerHTML = `Impossible d'obtenir votre position`; }
    );
}

function saveProfileLocation() {
    if (!window.tempProfileLocation && !window.profileMarker) {
        alert("Veuillez d'abord sélectionner une position sur la carte");
        return;
    }
    const pos = window.tempProfileLocation || window.profileMarker.getLatLng();
    const allUsers = JSON.parse(localStorage.getItem('ouenze_all_users') || '[]');
    const index = allUsers.findIndex(u => u.email === currentUser.email);
    if (index !== -1) {
        allUsers[index].locationLat = pos.lat;
        allUsers[index].locationLng = pos.lng;
        localStorage.setItem('ouenze_all_users', JSON.stringify(allUsers));
        alert("Position enregistrée avec succès !");
    }
}

function editField(field) {
    const userData = getUserData();
    let currentValue = '';
    let inputType = 'text';
    let placeholder = '';
    
    switch(field) {
        case 'fullName': currentValue = userData.fullName || ''; placeholder = "Nom complet"; break;
        case 'phone': currentValue = userData.phone || ''; placeholder = "+242 06 XX XX XX"; inputType = "tel"; break;
        case 'country': currentValue = userData.country || 'Congo-Brazzaville'; placeholder = "Pays"; break;
        case 'city': currentValue = userData.city || 'Brazzaville'; placeholder = "Ville"; break;
        case 'address': currentValue = userData.address || ''; placeholder = "Adresse"; break;
        case 'vehiclePlate': currentValue = userData.vehiclePlate || ''; placeholder = "AB-123-CD"; break;
        case 'vehicleType': currentValue = userData.vehicleType || ''; placeholder = "Moto, Voiture..."; break;
        default: return;
    }
    
    const modal = document.createElement('div'); modal.className = 'modal active';
    modal.innerHTML = `
        <div class="modal-card">
            <button class="modal-close" onclick="this.closest('.modal').remove()">&times;</button>
            <h3>Modifier ${field === 'fullName' ? 'le nom' : field === 'phone' ? 'le téléphone' : field === 'country' ? 'le pays' : field === 'city' ? 'la ville' : field === 'address' ? "l'adresse" : field === 'vehiclePlate' ? 'le matricule' : 'le type de véhicule'}</h3>
            <div class="form-group"><input type="${inputType}" id="editValue" value="${escapeHtml(currentValue)}" placeholder="${placeholder}"></div>
            <button class="btn-submit" onclick="saveFieldValue('${field}')">Enregistrer</button>
            <button class="btn-cancel" onclick="this.closest('.modal').remove()">Annuler</button>
        </div>
    `;
    document.body.appendChild(modal);
}

function saveFieldValue(field) {
    const value = document.getElementById('editValue')?.value.trim();
    if (!value) { alert("Veuillez remplir le champ"); return; }
    
    const allUsers = JSON.parse(localStorage.getItem('ouenze_all_users') || '[]');
    const index = allUsers.findIndex(u => u.email === currentUser.email);
    if (index !== -1) {
        allUsers[index][field] = value;
        if (field === 'fullName') currentUser.name = value;
        localStorage.setItem('ouenze_all_users', JSON.stringify(allUsers));
        saveData();
    }
    document.querySelector('.modal')?.remove();
    showProfile();
}

function editProfilePhoto() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (ev) => {
                const allUsers = JSON.parse(localStorage.getItem('ouenze_all_users') || '[]');
                const index = allUsers.findIndex(u => u.email === currentUser.email);
                if (index !== -1) {
                    allUsers[index].profilePhoto = ev.target.result;
                    localStorage.setItem('ouenze_all_users', JSON.stringify(allUsers));
                    currentUser.profilePhoto = ev.target.result;
                    saveData();
                    showProfile();
                }
            };
            reader.readAsDataURL(file);
        }
    };
    input.click();
}

function uploadDocument(docType) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (ev) => {
                const allUsers = JSON.parse(localStorage.getItem('ouenze_all_users') || '[]');
                const index = allUsers.findIndex(u => u.email === currentUser.email);
                if (index !== -1) {
                    allUsers[index][docType] = ev.target.result;
                    allUsers[index].documentsLastUpdate = new Date().toISOString();
                    localStorage.setItem('ouenze_all_users', JSON.stringify(allUsers));
                    alert(`Document mis à jour avec succès !`);
                    showProfile();
                }
            };
            reader.readAsDataURL(file);
        }
    };
    input.click();
}

function renderProfileOrders() {
    const container = document.getElementById('profileOrdersList');
    if (!container) return;
    const userOrders = orders.filter(o => o.userId === currentUser?.email);
    if (userOrders.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:20px;">Aucune commande</div>';
        return;
    }
    container.innerHTML = userOrders.map(o => `
        <div class="commande-item" style="background:var(--gray-100);border-radius:12px;padding:12px;margin-bottom:12px;border-left:3px solid var(--success);">
            <div><strong>${o.id}</strong> - ${new Date(o.date).toLocaleDateString()}</div>
            <div>${o.items?.length || 0} article(s) - ${o.total?.toLocaleString() || '0'} FCFA</div>
            <div>Paiement: ${o.paymentMethod || '-'}</div>
            <div style="color:var(--success);">${o.status || 'Confirmée'}</div>
            <button onclick="trackOrder('${o.id}')" style="margin-top:8px;background:var(--primary);color:white;border:none;padding:4px 12px;border-radius:20px;cursor:pointer;font-size:10px;">Suivre</button>
        </div>
    `).join('');
}

function attachProfileTabs() {
    document.querySelectorAll('.profile-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            currentProfileTab = tab.dataset.tab;
            showProfile();
        });
    });
}

// ============ AUTHENTIFICATION ============
function updateHeaderUI() {
    const container = document.getElementById('headerActions');
    if (currentUser) {
        container.innerHTML = `<div class="user-menu" onclick="showProfile()"><div class="user-avatar">${currentUser.profilePhoto ? `<img src="${currentUser.profilePhoto}" style="width:100%;height:100%;object-fit:cover;">` : currentUser.name.charAt(0)}</div><div class="user-info"><div>${currentUser.name.split(' ')[0]}</div><small>${currentUser.type === 'vendeur' ? 'Vendeur' : currentUser.type === 'livreur' ? 'Livreur' : 'Client'}</small></div><button onclick="event.stopPropagation();logout()" style="background:none;border:none;cursor:pointer;"><i class="fas fa-sign-out-alt"></i></button></div><div class="cart-icon" onclick="showCart()"><i class="fas fa-shopping-cart"></i><span class="cart-count">${cart.reduce((s,i)=>s+i.quantity,0)}</span></div>`;
    } else {
        container.innerHTML = `<button class="auth-btn" onclick="openLoginModal()">Connexion</button><button class="auth-btn" onclick="openRegisterModal()">Inscription</button><div class="cart-icon" onclick="showCart()"><i class="fas fa-shopping-cart"></i><span class="cart-count">0</span></div>`;
    }
    updateCartCount();
    updateVendorLink();
}

function openLoginModal() {
    const modal = document.createElement('div'); modal.className = 'modal active';
    modal.innerHTML = `
        <div class="modal-card">
            <button class="modal-close" onclick="this.closest('.modal').remove()">&times;</button>
            <h3 style="margin-bottom:20px;">Connexion</h3>
            <div class="form-group"><label>Email</label><input type="email" id="loginEmail" placeholder="exemple@email.com"></div>
            <div class="form-group"><label>Mot de passe</label><input type="password" id="loginPassword" placeholder="......"></div>
            <button class="btn-submit" onclick="doLogin()">Se connecter</button>
            <div style="text-align:center;margin-top:12px;"><a onclick="this.closest('.modal').remove();openRegisterModal()" style="color:var(--primary);cursor:pointer;">Creer un compte</a></div>
        </div>
    `;
    document.body.appendChild(modal);
}

function doLogin() {
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const allUsers = JSON.parse(localStorage.getItem('ouenze_all_users') || '[]');
    const user = allUsers.find(u => u.email === email && u.password === password);
    if (!user) { alert("Email ou mot de passe incorrect"); return; }
    if (user.status === 'pending') { alert("Votre compte est en attente de verification par l'administrateur."); return; }
    currentUser = { name: user.fullName, email: user.email, type: user.type, profilePhoto: user.profilePhoto };
    saveData();
    updateHeaderUI();
    document.querySelector('.modal')?.remove();
    resetToHome();
    alert(`Bienvenue ${currentUser.name}`);
}

function openRegisterModal() {
    currentStep = 1;
    tempUserData = {};
    generatedCode = "";
    const modal = document.createElement('div'); modal.className = 'modal active';
    modal.id = 'registerModal';
    modal.innerHTML = `<div class="modal-card"><button class="modal-close" onclick="this.closest('.modal').remove()">&times;</button><div class="step-indicator"><div class="step" id="step1">1. Informations</div><div class="step" id="step2">2. Verification</div><div class="step" id="step3">3. Validation</div></div><div id="stepContent"></div></div>`;
    document.body.appendChild(modal);
    renderRegisterStep();
}

function renderRegisterStep() {
    const stepContent = document.getElementById('stepContent');
    if (!stepContent) return;
    if (currentStep === 1) {
        stepContent.innerHTML = `
            <div class="form-group"><label>Type de compte</label>
                <select id="accountType" onchange="toggleAccountTypeFields()">
                    <option value="client">Client (acheteur)</option>
                    <option value="vendeur">Vendeur (boutique)</option>
                    <option value="livreur">Livreur</option>
                </select>
            </div>
            <div id="standardFields">
                <div class="form-group"><label>Nom complet</label><input type="text" id="fullName" placeholder="Jean Dupont"></div>
                <div class="form-group"><label>Email</label><input type="email" id="email" placeholder="exemple@email.com"></div>
                <div class="form-group"><label>Pays</label><select id="country"><option value="">Sélectionner</option>${countries.map(c => `<option value="${c.code}">${c.flag} ${c.name}</option>`).join('')}</select></div>
                <div class="form-group"><label>Ville</label><input type="text" id="city" placeholder="Brazzaville"></div>
                <div class="form-group"><label>Adresse</label><input type="text" id="address" placeholder="Rue, numéro"></div>
                <div class="form-group"><label>Telephone</label><div class="phone-input-group"><select id="phoneCountry">${countries.map(c => `<option value="${c.phoneCode}" ${c.phoneCode === "+242" ? "selected" : ""}>${c.flag} ${c.phoneCode}</option>`).join('')}</select><input type="tel" id="phone" placeholder="06 12 34 56"></div></div>
                <div class="form-group"><label>Mot de passe</label><input type="password" id="password" placeholder="......"></div>
                <div class="form-group"><label>Confirmer</label><input type="password" id="confirmPassword" placeholder="......"></div>
            </div>
            <div id="deliveryFields" style="display:none;">
                <div class="form-group"><label>Type de vehicule</label><select id="vehicleType"><option value="moto">Moto</option><option value="voiture">Voiture</option><option value="velo">Velo</option></select></div>
                <div class="form-group"><label>Matricule du véhicule</label><input type="text" id="vehiclePlate" placeholder="AB-123-CD"></div>
                <div class="form-group"><label>Pièce d'identité</label><input type="file" id="idCard" accept="image/*"></div>
                <div class="form-group"><label>Permis de conduire</label><input type="file" id="drivingLicense" accept="image/*"></div>
                <div class="form-group"><label>Photo du véhicule</label><input type="file" id="vehiclePhoto" accept="image/*"></div>
                <div class="info-text">Ces documents sont obligatoires pour les livreurs et doivent être mis à jour chaque trimestre</div>
            </div>
            <button class="btn-submit" onclick="validateStep1()">Continuer</button>
        `;
        toggleAccountTypeFields();
    } else if (currentStep === 2) {
        stepContent.innerHTML = `
            <div class="form-group"><label>Code de verification</label><input type="text" id="verifCode" placeholder="123456"></div>
            <div class="info-text">Un code a ete envoye a ${tempUserData.email || 'votre email'}</div>
            <div class="button-group"><button class="btn-cancel" onclick="prevStep()">Retour</button><button class="btn-submit" onclick="validateStep2()">Verifier</button></div>
        `;
    } else if (currentStep === 3) {
        stepContent.innerHTML = `
            <div class="info-text">Verification des informations en cours...</div>
            <button class="btn-submit" onclick="finalizeRegistration()">Finaliser l'inscription</button>
        `;
    }
    document.querySelectorAll('#registerModal .step').forEach((el, idx) => {
        el.classList.remove('active', 'completed');
        if (idx + 1 === currentStep) el.classList.add('active');
        else if (idx + 1 < currentStep) el.classList.add('completed');
    });
}

function toggleAccountTypeFields() {
    const type = document.getElementById('accountType')?.value;
    const deliveryFields = document.getElementById('deliveryFields');
    if (deliveryFields) deliveryFields.style.display = type === 'livreur' ? 'block' : 'none';
}

function validateStep1() {
    const type = document.getElementById('accountType').value;
    const fullName = document.getElementById('fullName').value.trim();
    const email = document.getElementById('email').value.trim();
    const countryCode = document.getElementById('phoneCountry').value;
    const phone = document.getElementById('phone').value.trim();
    const password = document.getElementById('password').value;
    const confirm = document.getElementById('confirmPassword').value;
    const country = document.getElementById('country')?.value;
    const city = document.getElementById('city')?.value.trim();
    const address = document.getElementById('address')?.value.trim();
    
    if (!fullName || !email || !phone || !password) { alert("Tous les champs sont obligatoires"); return; }
    if (!validateEmail(email)) { alert("Email invalide"); return; }
    if (!validatePhoneIntuitive(phone, countryCode)) { alert("Numero invalide"); return; }
    if (password !== confirm) { alert("Les mots de passe ne correspondent pas"); return; }
    if (password.length < 6) { alert("Mot de passe trop court (min 6 caracteres)"); return; }
    
    if (type === 'livreur') {
        const vehicleType = document.getElementById('vehicleType').value;
        const vehiclePlate = document.getElementById('vehiclePlate').value.trim();
        if (!vehiclePlate) { alert("Matricule du véhicule requis"); return; }
        
        const idCard = document.getElementById('idCard').files[0];
        const drivingLicense = document.getElementById('drivingLicense').files[0];
        const vehiclePhoto = document.getElementById('vehiclePhoto').files[0];
        
        if (!idCard) { alert("Pièce d'identité requise"); return; }
        if (!drivingLicense) { alert("Permis de conduire requis"); return; }
        if (!vehiclePhoto) { alert("Photo du véhicule requise"); return; }
        
        let loaded = 0;
        function checkComplete() {
            loaded++;
            if (loaded === 3) proceedAfterDocs();
        }
        const reader1 = new FileReader();
        const reader2 = new FileReader();
        const reader3 = new FileReader();
        reader1.onload = (e) => { tempUserData.idCard = e.target.result; checkComplete(); };
        reader2.onload = (e) => { tempUserData.drivingLicense = e.target.result; checkComplete(); };
        reader3.onload = (e) => { tempUserData.vehiclePhoto = e.target.result; checkComplete(); };
        reader1.readAsDataURL(idCard);
        reader2.readAsDataURL(drivingLicense);
        reader3.readAsDataURL(vehiclePhoto);
        
        function proceedAfterDocs() {
            tempUserData = { ...tempUserData, type, fullName, email, country, city, address, phone: `${countryCode} ${formatPhoneForDisplay(phone)}`, password, vehicleType, vehiclePlate, documentsLastUpdate: new Date().toISOString(), status: 'pending' };
            generatedCode = Math.floor(100000 + Math.random() * 900000).toString();
            sendEmail(email, "Code de verification Ouenze", `Votre code est: ${generatedCode}`);
            alert(`Code envoye a ${email}`);
            currentStep = 2;
            renderRegisterStep();
        }
        return;
    }
    
    tempUserData = { ...tempUserData, type, fullName, email, country, city, address, phone: `${countryCode} ${formatPhoneForDisplay(phone)}`, password, status: 'active' };
    generatedCode = Math.floor(100000 + Math.random() * 900000).toString();
    sendEmail(email, "Code de verification Ouenze", `Votre code est: ${generatedCode}`);
    alert(`Code envoye a ${email}`);
    currentStep = 2;
    renderRegisterStep();
}

function prevStep() { if (currentStep > 1) { currentStep--; renderRegisterStep(); } }

function validateStep2() {
    const code = document.getElementById('verifCode').value;
    if (code !== generatedCode) { alert("Code incorrect"); return; }
    currentStep = 3;
    renderRegisterStep();
}

function finalizeRegistration() {
    const allUsers = JSON.parse(localStorage.getItem('ouenze_all_users') || '[]');
    if (allUsers.find(u => u.email === tempUserData.email)) { alert("Email deja utilise"); return; }
    allUsers.push(tempUserData);
    localStorage.setItem('ouenze_all_users', JSON.stringify(allUsers));
    currentUser = { name: tempUserData.fullName, email: tempUserData.email, type: tempUserData.type };
    saveData();
    updateHeaderUI();
    document.querySelector('#registerModal')?.remove();
    alert(`Inscription reussie ! Bienvenue ${currentUser.name}`);
    if (tempUserData.type === 'vendeur') {
        alert("Redirection vers le createur de boutique...");
        window.location.href = 'shop-designer.html';
    } else {
        resetToHome();
    }
}

function logout() { 
    currentUser = null; 
    saveData(); 
    updateHeaderUI(); 
    resetToHome(); 
    alert("Deconnexion reussie"); 
}

// ============ FONCTIONS DIVERSES ============
function setRanking(type) { currentRanking = type; showHomePage(); }

function goToVendorDashboard() { 
    if (!currentUser || currentUser.type !== 'vendeur') { alert("Acces reserve aux vendeurs"); return; } 
    window.location.href = 'vendor-dashboard.html'; 
}

function showAbout() { alert("A propos - Ouenze Marketplace Congo Brazzaville"); }
function showHelp() { alert("Aide - Contactez notre support"); }
function showInvest() { alert("Investir dans Ouenze"); }
function showTracking() { alert("Suivi de livraison"); }

// ============ INITIALISATION ============
document.addEventListener('DOMContentLoaded', () => {
    updateHeaderUI();
    showHomePage();
    document.getElementById('searchBtn')?.addEventListener('click', performSearch);
    document.getElementById('searchInput')?.addEventListener('keypress', e => { if(e.key === 'Enter') performSearch(); });
    const dropBtn = document.getElementById('dropdownBtn');
    const dropCont = document.getElementById('dropdownContent');
    if(dropBtn) {
        dropBtn.addEventListener('click', (e) => { e.stopPropagation(); dropCont.classList.toggle('show'); });
        window.addEventListener('click', () => dropCont.classList.remove('show'));
    }
});

// Exports globaux pour les appels onclick
window.showHomePage = showHomePage;
window.viewShopDetail = viewShopDetail;
window.addToCart = addToCart;
window.setRanking = setRanking;
window.resetToHome = resetToHome;
window.showCart = showCart;
window.showMyOrders = showMyOrders;
window.showProfile = showProfile;
window.showDeliveryDashboard = showDeliveryDashboard;
window.acceptDeliveryOrder = acceptDeliveryOrder;
window.trackOrder = trackOrder;
window.getCurrentUserLocation = getCurrentUserLocation;
window.searchAddressLocation = searchAddressLocation;
window.resetMapView = resetMapView;
window.goToPayment = goToPayment;
window.validateOrder = validateOrder;
window.updateQuantity = updateQuantity;
window.removeFromCart = removeFromCart;
window.doLogin = doLogin;
window.logout = logout;
window.goToVendorDashboard = goToVendorDashboard;
window.goToDeliveryDashboard = goToDeliveryDashboard;
window.showAbout = showAbout;
window.showHelp = showHelp;
window.showInvest = showInvest;
window.showTracking = showTracking;
window.toggleAccountTypeFields = toggleAccountTypeFields;
window.validateStep1 = validateStep1;
window.validateStep2 = validateStep2;
window.prevStep = prevStep;
window.finalizeRegistration = finalizeRegistration;
window.openRegisterModal = openRegisterModal;
window.openLoginModal = openLoginModal;
window.updateCities = updateCities;
window.canDeliverToLocation = canDeliverToLocation;
window.canCombineShopsDelivery = canCombineShopsDelivery;
window.editField = editField;
window.saveFieldValue = saveFieldValue;
window.editProfilePhoto = editProfilePhoto;
window.uploadDocument = uploadDocument;
window.openRatingModal = openRatingModal;
window.openDeliveryRatingModal = openDeliveryRatingModal;
window.openChangePaymentModal = openChangePaymentModal;
window.getProfileCurrentLocation = getProfileCurrentLocation;
window.saveProfileLocation = saveProfileLocation;
window.setSort = setSort;
window.performSearch = performSearch;
window.displayProducts = displayProducts;
window.filterByProductType = filterByProductType;
window.addToCartFromModal = addToCartFromModal;
window.openProductModal = openProductModal;