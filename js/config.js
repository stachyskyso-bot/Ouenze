// config.js
const CONFIG = {
    baseUrl: '', // Laisser vide pour la racine
    pages: {
        home: 'index.html',
        shop: 'shop.html',
        shopDesigner: 'shop-designer.html',
        vendorDashboard: 'vendor-dashboard.html',
        tracking: 'tracking.html',
        invest: 'invest.html'
    }
};

// Utilisation
window.location.href = CONFIG.pages.tracking + '?id=' + orderId;