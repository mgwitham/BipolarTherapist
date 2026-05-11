import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const navSource = readFileSync(
  fileURLToPath(new URL("../../assets/nav.js", import.meta.url)),
  "utf8",
);

function createStorage(initial) {
  const values = new Map(Object.entries(initial || {}));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

function createElement(textContent = "") {
  return {
    href: "",
    textContent,
    dataset: {},
    style: {},
    classList: {
      add() {},
      remove() {},
      toggle() {
        return false;
      },
    },
    _children: Object.create(null),
    addEventListener() {},
    contains() {
      return false;
    },
    querySelector(selector) {
      return this._children[selector] || null;
    },
    setAttribute() {},
  };
}

function runNav({ local = {}, session = {} } = {}) {
  const desktopLink = createElement("Get Matched");
  const mobileTitle = createElement("Get Matched");
  const mobileCopy = createElement("Top matches");
  const mobileLink = createElement("");
  mobileLink._children[".public-mobile-nav-title"] = mobileTitle;
  mobileLink._children[".public-mobile-nav-copy"] = mobileCopy;

  const document = {
    body: { style: {} },
    addEventListener() {},
    getElementById(id) {
      return id === "navBrowseLink" ? desktopLink : null;
    },
    querySelector() {
      return null;
    },
    querySelectorAll(selector) {
      return selector === ".public-mobile-nav-link" ? [mobileLink] : [];
    },
  };

  const window = {
    localStorage: createStorage(local),
    sessionStorage: createStorage(session),
    location: { origin: "https://www.bipolartherapyhub.com" },
  };

  const context = vm.createContext({ console, document, URL, window });
  new vm.Script(navSource).runInContext(context);

  return { desktopLink, mobileLink, mobileTitle, mobileCopy };
}

test("nav state: a stored homepage ZIP does not imply matches exist", () => {
  const { desktopLink, mobileLink, mobileTitle, mobileCopy } = runNav({
    local: {
      bth_last_search: JSON.stringify({ interest: "therapist", location_query: "90019" }),
    },
  });

  // No results URL stored, so Get Matched routes to the homepage form
  // anchor. The homepage reads bth_last_search itself to prefill location.
  assert.equal(desktopLink.textContent, "Get Matched");
  assert.equal(desktopLink.href, "/#startMatch");
  assert.equal(mobileLink.href, "/#startMatch");
  assert.equal(mobileTitle.textContent, "Get matched");
  assert.equal(mobileCopy.textContent, "Start guided match");
});

test("nav state: rendered match results can be resumed as Your Matches", () => {
  const { desktopLink, mobileLink, mobileTitle, mobileCopy } = runNav({
    session: {
      matchResultsUrl:
        "https://www.bipolartherapyhub.com/match.html?care_intent=Therapy&location_query=90019",
    },
  });

  assert.equal(desktopLink.textContent, "Your Matches");
  assert.equal(desktopLink.href, "/match.html?care_intent=Therapy&location_query=90019");
  assert.equal(mobileLink.href, "/match.html?care_intent=Therapy&location_query=90019");
  assert.equal(mobileTitle.textContent, "Your matches");
  assert.equal(mobileCopy.textContent, "Resume your matches");
});

test("nav state: unsafe stored results URLs fall back to a fresh match", () => {
  const { desktopLink, mobileLink, mobileTitle } = runNav({
    session: {
      matchResultsUrl: "https://example.test/match.html?care_intent=Therapy&location_query=90019",
    },
  });

  assert.equal(desktopLink.textContent, "Get Matched");
  assert.equal(desktopLink.href, "/#startMatch");
  assert.equal(mobileLink.href, "/#startMatch");
  assert.equal(mobileTitle.textContent, "Get matched");
});
