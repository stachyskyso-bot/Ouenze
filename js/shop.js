{
    id: number,
    name: string,
    logo: string (base64),
    description: string,
    city: string,
    quartier: string,
    address: string,
    categories: string[],
    menu: {
        categories: [{ name: string, subcategories: string[] }],
        position: "horizontal" | "vertical-left" | "vertical-right",
        bg: string,
        text: string,
        radius: number
    },
    carousel: [{ type: "image" | "video", src: string }],
    products: [{
        id: number,
        name: string,
        price: number,
        category: string,
        stock: number,
        colors: string[],
        sizes: string[],
        photos: string[],
        description: string
    }],
    rating: number,
    totalRatings: number,
    reviews: [{
        user: string,
        rating: number,
        comment: string,
        date: string
    }],
    verified: boolean,
    design: {
        primary: string,
        button: string,
        background: string,
        headerTextColor: string,
        productTextColor: string,
        carouselHeight: number,
        carouselRadius: number,
        carouselSpeed: number,
        prodWidth: number,
        prodImgHeight: number,
        prodRadius: number,
        prodGap: number,
        layout: "grid" | "list",
        logoShape: "square" | "rounded" | "circle"
    }
}