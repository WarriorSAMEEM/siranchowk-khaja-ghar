/**
 * BAYAPANI KHAJA GHAR (बयापानी खाजा घर) - MAIN JAVASCRIPT
 * Official Website Script
 */

// Central Business Configuration
const SITE_CONFIG = {
  businessName: "Bayapani Khaja Ghar",
  nepaliName: "बयापानी खाजा घर",
  tagline: "Your Satisfaction Is Our Satisfaction",
  phone: "9821233154",
  whatsapp: "9779821233154",
  address: "Khairahani 6, Parsa, Chitwan, Nepal",
  landmark: "Behind Chaudhary Medical",
  hours: "6:30 AM – 9:00 PM",
  // Target Grand Opening Time: 28 September 2026, 06:30:00 Nepal Standard Time (UTC+5:45)
  openingTime: "2026-09-28T06:30:00+05:45",
  timezone: "Asia/Kathmandu",
  mapsUrl: "https://share.google/TQzV5f70BfISX9l1h"
};

// Menu Data Structure
const menuItems = [
  // MOMO
  {
    id: "momo-chicken",
    category: "momo",
    categoryLabel: "Momo",
    name: "Chicken Momo",
    nepaliName: "चिकेन म:म",
    description: "Steamed dumplings filled with spiced minced chicken, fresh herbs, and served with signature chutney.",
    priceNote: "Price available at counter",
    available: true,
    availabilityNote: "Prepared fresh daily",
    image: "https://images.unsplash.com/photo-1625220194771-7ebdea0b70b9?auto=format&fit=crop&w=600&q=80",
    alt: "Steamed Nepali Chicken Momo served with spicy chutney"
  },
  {
    id: "momo-buff",
    category: "momo",
    categoryLabel: "Momo",
    name: "Buff Momo",
    nepaliName: "बफ म:म",
    description: "Traditional Nepali buff dumplings steamed hot and served with fresh tomato-sesame chutney.",
    priceNote: "Price available at counter",
    available: true,
    availabilityNote: "Prepared fresh daily",
    image: "https://images.unsplash.com/photo-1534422298391-e4f8c172dddb?auto=format&fit=crop&w=600&q=80",
    alt: "Steamed Nepali Buff Momo with spicy sauce"
  },

  // CHOWMEIN
  {
    id: "chowmein-veg",
    category: "chowmein",
    categoryLabel: "Chowmein",
    name: "Veg Chowmein",
    nepaliName: "भेज चाउमिन",
    description: "Stir-fried Nepali-style noodles tossed with crisp cabbage, carrots, onion, and savory spices.",
    priceNote: "Price available at counter",
    available: true,
    availabilityNote: "Prepared fresh daily",
    image: "https://images.unsplash.com/photo-1612929633738-8fe44f7ec841?auto=format&fit=crop&w=600&q=80",
    alt: "Nepali Vegetable Chowmein noodles"
  },
  {
    id: "chowmein-chicken",
    category: "chowmein",
    categoryLabel: "Chowmein",
    name: "Chicken Chowmein",
    nepaliName: "चिकेन चाउमिन",
    description: "Fresh wok-fried noodles tossed with spiced chicken strips, mixed vegetables, and local seasonings.",
    priceNote: "Price available at counter",
    available: true,
    availabilityNote: "Prepared fresh daily",
    image: "https://images.unsplash.com/photo-1585032226651-759b368d7246?auto=format&fit=crop&w=600&q=80",
    alt: "Nepali Chicken Chowmein noodles"
  },

  // BREAD / ROTI
  {
    id: "roti-plain",
    category: "roti",
    categoryLabel: "Bread / Roti",
    name: "Roti",
    nepaliName: "रोटी",
    description: "Soft whole wheat flatbread made warm on the griddle upon request.",
    priceNote: "Price available at counter",
    available: true,
    availabilityNote: "Available all day",
    image: "https://images.unsplash.com/photo-1565557623262-b51c2513a641?auto=format&fit=crop&w=600&q=80",
    alt: "Fresh hot whole wheat Nepali Roti"
  },
  {
    id: "roti-paratha",
    category: "roti",
    categoryLabel: "Bread / Roti",
    name: "Paratha",
    nepaliName: "पराठा",
    description: "Warm, layered flatbread fried lightly with ghee/oil. Ideal with morning tea or curry.",
    priceNote: "Price available at counter",
    available: true,
    availabilityNote: "Available all day",
    image: "https://images.unsplash.com/photo-1626777552726-4a6b54c97e46?auto=format&fit=crop&w=600&q=80",
    alt: "Golden crispy Nepali Paratha"
  },

  // TEA
  {
    id: "tea-milk",
    category: "tea",
    categoryLabel: "Tea",
    name: "Milk Tea",
    nepaliName: "चिया (दुध)",
    description: "Traditional Nepali milk tea brewed hot with quality CTC tea leaves and fresh milk.",
    priceNote: "Price available at counter",
    available: true,
    availabilityNote: "Freshly brewed",
    image: "https://images.unsplash.com/photo-1576092768241-dec231879fc3?auto=format&fit=crop&w=600&q=80",
    alt: "Hot Nepali milk tea in a glass cup"
  },
  {
    id: "tea-black",
    category: "tea",
    categoryLabel: "Tea",
    name: "Black Tea",
    nepaliName: "कालो चिया",
    description: "Aromatic black tea brewed hot with optional ginger or lemon touch.",
    priceNote: "Price available at counter",
    available: true,
    availabilityNote: "Freshly brewed",
    image: "https://images.unsplash.com/photo-1597481499750-3e6b22637e12?auto=format&fit=crop&w=600&q=80",
    alt: "Fresh hot black tea in a glass"
  },

  // RICE / SPECIAL
  {
    id: "special-biryani",
    category: "special",
    categoryLabel: "Rice & Special",
    name: "Biryani",
    nepaliName: "बिरयानी",
    description: "Fragrant rice dish cooked with herbs, rich spices, and marinated chicken.",
    priceNote: "Available on Fridays and special days",
    available: true,
    availabilityNote: "Friday & Special Days Only",
    image: "https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?auto=format&fit=crop&w=600&q=80",
    alt: "Special Chicken Biryani rice dish"
  },

  // SNACKS / OTHER
  {
    id: "snack-chana",
    category: "snacks",
    categoryLabel: "Snacks / Other",
    name: "Chana",
    nepaliName: "चना",
    description: "Spiced chickpeas sauteed with onions, green chilies, and Nepali masalas.",
    priceNote: "Price available at counter",
    available: true,
    availabilityNote: "Great with hot tea",
    image: "https://images.unsplash.com/photo-1546833999-b9f581a1996d?auto=format&fit=crop&w=600&q=80",
    alt: "Spiced Nepali Chana snack"
  },
  {
    id: "snack-keema",
    category: "snacks",
    categoryLabel: "Snacks / Other",
    name: "Keema",
    nepaliName: "कीमा",
    description: "Minced meat cooked with garlic, onions, and spicy gravy.",
    priceNote: "Price available at counter",
    available: true,
    availabilityNote: "Prepared fresh",
    image: "https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?auto=format&fit=crop&w=600&q=80",
    alt: "Spiced Keema fry"
  },
  {
    id: "snack-suputi",
    category: "snacks",
    categoryLabel: "Snacks / Other",
    name: "Suputi",
    nepaliName: "सुपुटी",
    description: "Traditional seasoned local fried dish enjoyed with tea or snacks.",
    priceNote: "Price available at counter",
    available: true,
    availabilityNote: "Local favorite",
    image: "https://images.unsplash.com/photo-1601050690597-df0568f70950?auto=format&fit=crop&w=600&q=80",
    alt: "Nepali local snack dish"
  },
  {
    id: "snack-boiled-egg",
    category: "snacks",
    categoryLabel: "Snacks / Other",
    name: "Boiled Egg",
    nepaliName: "उसिनेको अण्डा",
    description: "Fresh boiled eggs served with salt and chili pepper seasoning.",
    priceNote: "Price available at counter",
    available: true,
    availabilityNote: "Quick healthy option",
    image: "https://images.unsplash.com/photo-1582722872445-44dc5f7e3c8f?auto=format&fit=crop&w=600&q=80",
    alt: "Fresh Boiled Eggs with salt and pepper"
  },
  {
    id: "snack-fried-chicken",
    category: "snacks",
    categoryLabel: "Snacks / Other",
    name: "Fried Chicken",
    nepaliName: "फ्राइड चिकेन",
    description: "Crispy seasoned chicken pieces fried to golden perfection.",
    priceNote: "Price available at counter",
    available: true,
    availabilityNote: "Crispy and fresh",
    image: "https://images.unsplash.com/photo-1626645738196-c2a7c87a8f58?auto=format&fit=crop&w=600&q=80",
    alt: "Golden crispy fried chicken"
  }
];

// DOM Ready Event Listener
document.addEventListener("DOMContentLoaded", () => {
  initMobileNav();
  initCountdown();
  initMenuPage();
  setCurrentYear();
  highlightActiveNav();
});

/* --------------------------------------------------------------------------
   1. MOBILE NAVIGATION TOGGLE
   -------------------------------------------------------------------------- */
function initMobileNav() {
  const toggleBtn = document.querySelector(".mobile-nav-toggle");
  const nav = document.getElementById("primary-nav");

  if (!toggleBtn || !nav) return;

  toggleBtn.addEventListener("click", () => {
    const isExpanded = toggleBtn.getAttribute("aria-expanded") === "true";
    toggleBtn.setAttribute("aria-expanded", !isExpanded);
    nav.classList.toggle("is-open");
  });

  // Close menu when clicking outside
  document.addEventListener("click", (e) => {
    if (!nav.contains(e.target) && !toggleBtn.contains(e.target) && nav.classList.contains("is-open")) {
      nav.classList.remove("is-open");
      toggleBtn.setAttribute("aria-expanded", "false");
    }
  });
}

/* --------------------------------------------------------------------------
   2. GRAND OPENING COUNTDOWN TIMER
   -------------------------------------------------------------------------- */
function initCountdown() {
  const timerDays = document.getElementById("timer-days");
  const timerHours = document.getElementById("timer-hours");
  const timerMins = document.getElementById("timer-mins");
  const timerSecs = document.getElementById("timer-secs");
  const countdownTimer = document.getElementById("countdown-timer");
  const openStatusMsg = document.getElementById("open-status-message");
  const openingBadge = document.getElementById("opening-badge");

  if (!timerDays || !timerHours || !timerMins || !timerSecs) return;

  const openingDate = new Date(SITE_CONFIG.openingTime).getTime();

  function updateTimer() {
    const now = new Date().getTime();
    const timeDifference = openingDate - now;

    if (timeDifference <= 0) {
      // Past opening time
      if (countdownTimer) countdownTimer.classList.add("hidden");
      if (openStatusMsg) openStatusMsg.classList.remove("hidden");
      if (openingBadge) {
        openingBadge.textContent = "NOW OPEN";
        openingBadge.style.backgroundColor = "var(--color-whatsapp)";
        openingBadge.style.color = "#ffffff";
      }
      return;
    }

    // Time calculations
    const days = Math.floor(timeDifference / (1000 * 60 * 60 * 24));
    const hours = Math.floor((timeDifference % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((timeDifference % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((timeDifference % (1000 * 60)) / 1000);

    timerDays.textContent = String(days).padStart(2, "0");
    timerHours.textContent = String(hours).padStart(2, "0");
    timerMins.textContent = String(minutes).padStart(2, "0");
    timerSecs.textContent = String(seconds).padStart(2, "0");
  }

  updateTimer();
  const timerInterval = setInterval(updateTimer, 1000);
}

/* --------------------------------------------------------------------------
   3. MENU PAGE RENDERING & FILTERING
   -------------------------------------------------------------------------- */
function initMenuPage() {
  const menuContainer = document.getElementById("menu-grid-container");
  if (!menuContainer) return;

  const filterBtns = document.querySelectorAll(".filter-btn");

  // Check URL query string for default category filter (e.g. menu.html?category=momo)
  const urlParams = new URLSearchParams(window.location.search);
  const initialCategory = urlParams.get("category") || "all";

  renderMenuItems(initialCategory);

  // Set active filter button based on initial category
  filterBtns.forEach(btn => {
    if (btn.getAttribute("data-category") === initialCategory) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }

    btn.addEventListener("click", () => {
      filterBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const category = btn.getAttribute("data-category");
      renderMenuItems(category);
    });
  });
}

function renderMenuItems(category) {
  const menuContainer = document.getElementById("menu-grid-container");
  if (!menuContainer) return;

  menuContainer.innerHTML = "";

  const filteredItems = category === "all" 
    ? menuItems 
    : menuItems.filter(item => item.category === category);

  if (filteredItems.length === 0) {
    menuContainer.innerHTML = `<p style="grid-column: 1/-1; text-align: center; padding: 2rem;">No menu items found in this category.</p>`;
    return;
  }

  filteredItems.forEach(item => {
    const isSpecial = item.category === "special";
    const waText = encodeURIComponent(`Hello Bayapani Khaja Ghar, I would like to order ${item.name}.`);
    const waUrl = `https://wa.me/${SITE_CONFIG.whatsapp}?text=${waText}`;

    const cardHtml = `
      <div class="dish-card ${isSpecial ? 'special-dish-card' : ''}">
        <div class="dish-img-wrapper">
          <img src="${item.image}" alt="${item.alt}" loading="lazy">
          ${isSpecial ? `<span class="dish-badge special-badge">Friday & Special Days</span>` : ''}
        </div>
        <div class="dish-info">
          <div class="dish-title-row">
            <h3>${item.name}</h3>
            <span class="dish-nepali">${item.nepaliName}</span>
          </div>
          <p class="dish-desc">${item.description}</p>
          <div class="dish-footer">
            <span class="dish-price">${item.priceNote}</span>
            <a href="${waUrl}" target="_blank" rel="noopener" class="btn-sm btn-whatsapp">
              ${isSpecial ? 'Inquire' : 'Order'}
            </a>
          </div>
        </div>
      </div>
    `;

    menuContainer.insertAdjacentHTML("beforeend", cardHtml);
  });
}

/* --------------------------------------------------------------------------
   4. HELPER FUNCTIONS
   -------------------------------------------------------------------------- */
function setCurrentYear() {
  const yearEls = document.querySelectorAll("#current-year");
  const currentYear = new Date().getFullYear();
  yearEls.forEach(el => el.textContent = currentYear);
}

function highlightActiveNav() {
  const currentPath = window.location.pathname.split("/").pop() || "index.html";
  const navLinks = document.querySelectorAll(".nav-link");

  navLinks.forEach(link => {
    const href = link.getAttribute("href");
    if (href === currentPath || (currentPath === "" && href === "index.html")) {
      link.classList.add("active");
    } else {
      link.classList.remove("active");
    }
  });
}