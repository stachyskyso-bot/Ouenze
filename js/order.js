{
    id: string,
    userId: string,
    userName: string,
    items: [{
        productId: number,
        productName: string,
        price: number,
        quantity: number,
        shopId: number,
        shopName: string
    }],
    subtotal: number,
    deliveryFees: number,
    total: number,
    deliveryInfo: {
        city: string,
        quartier: string,
        address: string,
        phone: string
    },
    paymentMethod: "card" | "mobile" | "cash",
    paymentDetails: object,
    date: string,
    status: string,
    trackingStep: number,
    statusHistory: [{
        status: string,
        date: string,
        message: string
    }],
    rated: boolean
}