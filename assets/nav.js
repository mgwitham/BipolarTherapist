(function () {
  const btn = document.querySelector(".nav-hamburger");
  const mobileNav = document.querySelector(".public-mobile-nav");
  if (!btn || !mobileNav) return;

  btn.addEventListener("click", function () {
    const isOpen = mobileNav.classList.toggle("is-open");
    btn.setAttribute("aria-expanded", String(isOpen));
    document.body.style.overflow = isOpen ? "hidden" : "";
  });

  document.addEventListener("click", function (e) {
    if (!btn.contains(e.target) && !mobileNav.contains(e.target)) {
      mobileNav.classList.remove("is-open");
      btn.setAttribute("aria-expanded", "false");
      document.body.style.overflow = "";
    }
  });
})();
