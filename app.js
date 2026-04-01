require("dotenv").config({ quiet: true });

const express = require("express");
const path = require("path");
const helmet = require("helmet");
const session = require("express-session");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;

const members = require("./data/members");
const productCatalog = require("./data/products");

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === "production";

const sessionSecret = process.env.SESSION_SECRET;
if (isProduction && !sessionSecret) {
  throw new Error("SESSION_SECRET harus diset saat production.");
}

const FONT_CHOICES = {
  "plus-jakarta": "'Plus Jakarta Sans', sans-serif",
  outfit: "'Outfit', sans-serif",
  sora: "'Sora', sans-serif",
  fraunces: "'Fraunces', serif"
};

const DEFAULT_THEME = {
  bgColor: "#f6f4ef",
  textColor: "#13233a",
  cardColor: "#ffffff",
  accentColor: "#f35f3a",
  fontKey: "plus-jakarta",
  fontFamily: FONT_CHOICES["plus-jakarta"]
};

let storefrontTheme = { ...DEFAULT_THEME };
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

const allowedMemberEmails = new Set(
  (process.env.ALLOWED_MEMBER_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
);

const googleOAuthEnabled =
  Boolean(process.env.GOOGLE_CLIENT_ID) &&
  Boolean(process.env.GOOGLE_CLIENT_SECRET) &&
  Boolean(process.env.GOOGLE_CALLBACK_URL);

const productStock = new Map(
  productCatalog.map((product) => [product.id, product.baseStock || 0])
);

const reviews = [];
let reviewSequence = 1;
for (const seed of [
  {
    productId: "SKU-PLM-001",
    userName: "Anya",
    userEmail: "anya@example.com",
    rating: 5,
    comment: "Typing feel sangat nyaman untuk kerja harian."
  },
  {
    productId: "SKU-PLM-002",
    userName: "Dafa",
    userEmail: "dafa@example.com",
    rating: 4,
    comment: "Ringkas dan cocok buat kamar."
  },
  {
    productId: "SKU-PLM-004",
    userName: "Gita",
    userEmail: "gita@example.com",
    rating: 5,
    comment: "Kursinya stabil, duduk lama tetap enak."
  }
]) {
  reviews.push({
    id: `RVW-${reviewSequence}`,
    ...seed,
    createdAt: new Date(Date.now() - reviewSequence * 3600 * 1000).toISOString()
  });
  reviewSequence += 1;
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function setToast(req, type, text) {
  req.session.toast = { type, text };
}

function takeToast(req) {
  const toast = req.session.toast || null;
  delete req.session.toast;
  return toast;
}

function safeBackPath(req, fallbackPath) {
  const referer = req.get("referer");
  if (!referer) {
    return fallbackPath;
  }

  try {
    const parsed = new URL(referer);
    if (parsed.host === req.get("host")) {
      return `${parsed.pathname}${parsed.search}`;
    }
  } catch {
    return fallbackPath;
  }
  return fallbackPath;
}

function normalizeThemeInput(themeInput) {
  if (!themeInput) {
    return null;
  }

  const { bgColor, textColor, cardColor, accentColor, fontKey } = themeInput;

  if (
    !HEX_COLOR_PATTERN.test(bgColor || "") ||
    !HEX_COLOR_PATTERN.test(textColor || "") ||
    !HEX_COLOR_PATTERN.test(cardColor || "") ||
    !HEX_COLOR_PATTERN.test(accentColor || "") ||
    !Object.hasOwn(FONT_CHOICES, fontKey || "")
  ) {
    return null;
  }

  return {
    bgColor,
    textColor,
    cardColor,
    accentColor,
    fontKey,
    fontFamily: FONT_CHOICES[fontKey]
  };
}

function toPositiveInt(value, fallbackValue = 1) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    return fallbackValue;
  }
  return parsed;
}

function getSessionCart(req) {
  if (!Array.isArray(req.session.cart)) {
    req.session.cart = [];
  }
  return req.session.cart;
}

function getReviewStats(productId) {
  const productReviews = reviews.filter((review) => review.productId === productId);
  const reviewCount = productReviews.length;
  const averageRating =
    reviewCount > 0
      ? Number(
          (
            productReviews.reduce((sum, review) => sum + review.rating, 0) / reviewCount
          ).toFixed(1)
        )
      : null;
  return { reviewCount, averageRating, productReviews };
}

function getProductsForList() {
  return productCatalog.map((product) => {
    const stats = getReviewStats(product.id);
    return {
      ...product,
      stock: productStock.get(product.id) || 0,
      reviewCount: stats.reviewCount,
      averageRating: stats.averageRating
    };
  });
}

function getProductDetail(productId) {
  const product = productCatalog.find((item) => item.id === productId);
  if (!product) {
    return null;
  }

  const stats = getReviewStats(productId);
  const sortedReviews = [...stats.productReviews].sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );

  return {
    ...product,
    stock: productStock.get(product.id) || 0,
    reviewCount: stats.reviewCount,
    averageRating: stats.averageRating,
    reviews: sortedReviews
  };
}

function getCartState(req, productsForList = null) {
  const products = productsForList || getProductsForList();
  const byId = new Map(products.map((product) => [product.id, product]));
  const rawCart = getSessionCart(req);

  const items = rawCart
    .map((line) => {
      const product = byId.get(line.productId);
      if (!product) {
        return null;
      }
      const quantity = Math.min(toPositiveInt(line.quantity, 1), product.stock);
      if (quantity < 1) {
        return null;
      }
      return {
        productId: product.id,
        name: product.name,
        price: product.price,
        quantity,
        lineTotal: product.price * quantity,
        stock: product.stock
      };
    })
    .filter(Boolean);

  req.session.cart = items.map((item) => ({
    productId: item.productId,
    quantity: item.quantity
  }));

  const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);

  return { items, totalItems, subtotal };
}

function renderPage(req, res, view, pageData = {}) {
  const products = getProductsForList();
  const cart = getCartState(req, products);

  const user = req.user || null;
  const role = user && user.isAdmin ? "admin" : user ? "customer" : "guest";

  res.render(view, {
    groupName: "JanjiMart",
    theme: storefrontTheme,
    nav: {
      current: view,
      links: [
        { href: "/", label: "Home", key: "home" },
        { href: "/products", label: "Products", key: "products" },
        { href: "/cart", label: "Cart", key: "cart", count: cart.totalItems },
        { href: "/team", label: "Team", key: "team" },
        { href: "/account", label: "Account", key: "account" },
        ...(user && user.isAdmin ? [{ href: "/admin", label: "Admin", key: "admin" }] : [])
      ]
    },
    auth: {
      isLoggedIn: Boolean(user),
      isAdmin: Boolean(user && user.isAdmin),
      role,
      user
    },
    toast: takeToast(req),
    cart,
    ...pageData
  });
}

function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) {
    return next();
  }

  setToast(req, "error", "Silakan login Google terlebih dahulu.");
  return res.redirect("/account");
}

function ensureAdmin(req, res, next) {
  if (req.user && req.user.isAdmin) {
    return next();
  }

  setToast(req, "error", "Hanya akun anggota kelompok yang dapat mengubah tampilan.");
  return res.redirect("/account");
}

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

if (isProduction) {
  app.set("trust proxy", 1);
}

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
        imgSrc: ["'self'", "data:", "https://lh3.googleusercontent.com"],
        scriptSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"]
      }
    }
  })
);

app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    secret: sessionSecret || "dev-session-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: isProduction,
      maxAge: 1000 * 60 * 60 * 8
    }
  })
);

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((user, done) => {
  const email = normalizeEmail(user && user.email);
  done(null, {
    id: user && user.id ? user.id : email,
    name: user && user.name ? user.name : "Pengguna",
    email,
    photo: user && user.photo ? user.photo : null,
    isAdmin: allowedMemberEmails.has(email)
  });
});

if (googleOAuthEnabled) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: process.env.GOOGLE_CALLBACK_URL
      },
      (_accessToken, _refreshToken, profile, done) => {
        const email = normalizeEmail(
          profile.emails && profile.emails[0] && profile.emails[0].value
            ? profile.emails[0].value
            : ""
        );

        if (!email) {
          return done(new Error("Email Google tidak ditemukan."));
        }

        const user = {
          id: profile.id || email,
          name: profile.displayName || email,
          email,
          photo:
            profile.photos && profile.photos[0] && profile.photos[0].value
              ? profile.photos[0].value
              : null,
          isAdmin: allowedMemberEmails.has(email)
        };

        return done(null, user);
      }
    )
  );
}

app.get("/", (req, res) => {
  const products = getProductsForList();
  renderPage(req, res, "home", {
    heroProducts: products.slice(0, 4)
  });
});

app.get("/products", (req, res) => {
  renderPage(req, res, "products", {
    products: getProductsForList()
  });
});

app.get("/products/:id", (req, res) => {
  const product = getProductDetail(req.params.id);
  if (!product) {
    setToast(req, "error", "Produk tidak ditemukan.");
    return res.redirect("/products");
  }

  return renderPage(req, res, "product-detail", {
    product
  });
});

app.get("/cart", (req, res) => {
  renderPage(req, res, "cart");
});

app.get("/team", (req, res) => {
  renderPage(req, res, "team", {
    members
  });
});

app.get("/account", (req, res) => {
  renderPage(req, res, "account", {
    googleOAuthEnabled
  });
});

app.get("/admin", ensureAuthenticated, ensureAdmin, (req, res) => {
  renderPage(req, res, "admin", {
    fontChoices: Object.keys(FONT_CHOICES)
  });
});

app.get("/auth/google", (req, res, next) => {
  if (!googleOAuthEnabled) {
    setToast(req, "error", "OAuth Google belum dikonfigurasi.");
    return res.redirect("/account");
  }

  return passport.authenticate("google", {
    scope: ["openid", "profile", "email"],
    prompt: "select_account",
    state: true
  })(req, res, next);
});

app.get("/auth/google/callback", (req, res, next) => {
  if (!googleOAuthEnabled) {
    setToast(req, "error", "OAuth Google belum dikonfigurasi.");
    return res.redirect("/account");
  }

  return passport.authenticate("google", (authError, user) => {
    if (authError || !user) {
      setToast(req, "error", "Login Google gagal. Coba lagi.");
      return res.redirect("/account");
    }

    return req.session.regenerate((regenError) => {
      if (regenError) {
        return next(regenError);
      }

      return req.logIn(user, (loginError) => {
        if (loginError) {
          return next(loginError);
        }
        setToast(req, "success", `Login berhasil sebagai ${user.name}.`);
        return res.redirect("/account");
      });
    });
  })(req, res, next);
});

app.post("/logout", ensureAuthenticated, (req, res, next) => {
  req.logout((logoutError) => {
    if (logoutError) {
      return next(logoutError);
    }
    return req.session.regenerate((regenError) => {
      if (regenError) {
        return next(regenError);
      }
      setToast(req, "success", "Logout berhasil.");
      return res.redirect("/account");
    });
  });
});

app.post("/admin/theme", ensureAuthenticated, ensureAdmin, (req, res) => {
  const normalizedTheme = normalizeThemeInput(req.body);
  if (!normalizedTheme) {
    setToast(req, "error", "Input tampilan tidak valid.");
    return res.redirect("/admin");
  }

  storefrontTheme = normalizedTheme;
  setToast(req, "success", "Tampilan storefront berhasil diperbarui.");
  return res.redirect("/admin");
});

app.post("/cart/add", (req, res) => {
  const productId = String(req.body.productId || "").trim();
  const quantity = toPositiveInt(req.body.quantity, 1);
  const product = getProductDetail(productId);

  if (!product) {
    setToast(req, "error", "Produk tidak ditemukan.");
    return res.redirect("/products");
  }

  const cart = getSessionCart(req);
  const existingLine = cart.find((line) => line.productId === productId);
  const existingQty = existingLine ? toPositiveInt(existingLine.quantity, 1) : 0;
  const nextQty = existingQty + quantity;

  if (nextQty > product.stock) {
    setToast(req, "error", "Stok tidak mencukupi.");
    return res.redirect(`/products/${productId}`);
  }

  if (existingLine) {
    existingLine.quantity = nextQty;
  } else {
    cart.push({ productId, quantity });
  }

  setToast(req, "success", "Produk ditambahkan ke keranjang.");
  return res.redirect(safeBackPath(req, `/products/${productId}`));
});

app.post("/cart/update", (req, res) => {
  const productId = String(req.body.productId || "").trim();
  const action = String(req.body.action || "").trim().toLowerCase();

  const cart = getSessionCart(req);
  const line = cart.find((item) => item.productId === productId);
  if (!line) {
    setToast(req, "error", "Item keranjang tidak ditemukan.");
    return res.redirect("/cart");
  }

  const product = getProductDetail(productId);
  if (!product) {
    req.session.cart = cart.filter((item) => item.productId !== productId);
    setToast(req, "error", "Produk sudah tidak tersedia.");
    return res.redirect("/cart");
  }

  if (action === "inc") {
    const nextQty = toPositiveInt(line.quantity, 1) + 1;
    if (nextQty > product.stock) {
      setToast(req, "error", "Stok tidak mencukupi.");
      return res.redirect("/cart");
    }
    line.quantity = nextQty;
  } else if (action === "dec") {
    const nextQty = toPositiveInt(line.quantity, 1) - 1;
    if (nextQty < 1) {
      req.session.cart = cart.filter((item) => item.productId !== productId);
    } else {
      line.quantity = nextQty;
    }
  } else {
    const qty = toPositiveInt(req.body.quantity, 1);
    if (qty > product.stock) {
      setToast(req, "error", "Stok tidak mencukupi.");
      return res.redirect("/cart");
    }
    line.quantity = qty;
  }

  return res.redirect("/cart");
});

app.post("/cart/remove", (req, res) => {
  const productId = String(req.body.productId || "").trim();
  req.session.cart = getSessionCart(req).filter((item) => item.productId !== productId);
  return res.redirect("/cart");
});

app.post("/cart/checkout", ensureAuthenticated, (req, res) => {
  const cartState = getCartState(req);
  if (cartState.items.length === 0) {
    setToast(req, "error", "Keranjang masih kosong.");
    return res.redirect("/cart");
  }

  for (const item of cartState.items) {
    const stock = productStock.get(item.productId) || 0;
    if (item.quantity > stock) {
      setToast(req, "error", "Ada produk dengan stok kurang.");
      return res.redirect("/cart");
    }
  }

  for (const item of cartState.items) {
    const stock = productStock.get(item.productId) || 0;
    productStock.set(item.productId, Math.max(stock - item.quantity, 0));
  }

  req.session.cart = [];
  setToast(req, "success", "Checkout demo berhasil.");
  return res.redirect("/products");
});

app.post("/products/:id/reviews", ensureAuthenticated, (req, res) => {
  const product = getProductDetail(req.params.id);
  if (!product) {
    setToast(req, "error", "Produk tidak ditemukan.");
    return res.redirect("/products");
  }

  const rating = toPositiveInt(req.body.rating, 0);
  const comment = String(req.body.comment || "").trim();

  if (rating < 1 || rating > 5 || comment.length < 6) {
    setToast(req, "error", "Review tidak valid.");
    return res.redirect(`/products/${product.id}`);
  }

  reviews.push({
    id: `RVW-${reviewSequence}`,
    productId: product.id,
    userName: req.user.name || req.user.email,
    userEmail: req.user.email,
    rating,
    comment,
    createdAt: new Date().toISOString()
  });
  reviewSequence += 1;

  setToast(req, "success", "Review berhasil ditambahkan.");
  return res.redirect(`/products/${product.id}`);
});

app.post("/admin/products/:id/stock", ensureAuthenticated, ensureAdmin, (req, res) => {
  const product = getProductDetail(req.params.id);
  if (!product) {
    setToast(req, "error", "Produk tidak ditemukan.");
    return res.redirect("/products");
  }

  const stock = Number.parseInt(req.body.stock, 10);
  if (Number.isNaN(stock) || stock < 0) {
    setToast(req, "error", "Nilai stok tidak valid.");
    return res.redirect(`/products/${product.id}`);
  }

  productStock.set(product.id, stock);
  setToast(req, "success", "Stok berhasil diperbarui.");
  return res.redirect(`/products/${product.id}`);
});

app.post("/admin/reviews/:reviewId/delete", ensureAuthenticated, ensureAdmin, (req, res) => {
  const reviewId = String(req.params.reviewId || "").trim();
  const index = reviews.findIndex((review) => review.id === reviewId);
  const fallback = safeBackPath(req, "/products");

  if (index < 0) {
    setToast(req, "error", "Review tidak ditemukan.");
    return res.redirect(fallback);
  }

  reviews.splice(index, 1);
  setToast(req, "success", "Review berhasil dihapus.");
  return res.redirect(fallback);
});

app.listen(PORT, () => {
  console.log(`Server berjalan di port ${PORT}`);
});
