import { Readable } from "node:stream";

export function createResponseCapture() {
  return {
    statusCode: null,
    headers: null,
    payload: null,
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(body) {
      if (!body) {
        this.payload = null;
        this.rawBody = "";
        return;
      }
      this.rawBody = body;
      try {
        this.payload = JSON.parse(body);
      } catch (_error) {
        this.payload = body;
      }
    },
  };
}

export function createJsonRequest({ body, headers, method, url }) {
  const payload = body ? JSON.stringify(body) : "";
  const request = Readable.from(payload ? [payload] : []);
  request.method = method;
  request.url = url;
  request.headers = headers || {};
  request.socket = {
    remoteAddress: "127.0.0.1",
  };
  request.destroy = function destroy() {};
  return request;
}

export async function runHandlerRequest(handler, requestOptions) {
  const response = createResponseCapture();
  await handler(createJsonRequest(requestOptions), response);
  return response;
}

export function createSendJson(response) {
  return function sendJson(_res, statusCode, payload) {
    response.statusCode = statusCode;
    response.payload = payload;
  };
}

export function deepClone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

export function createTransactionSpy(state) {
  const operations = [];

  return {
    operations,
    create(document) {
      operations.push({ type: "create", document });
      return this;
    },
    createOrReplace(document) {
      operations.push({ type: "createOrReplace", document });
      return this;
    },
    delete(id) {
      operations.push({ type: "delete", id });
      return this;
    },
    patch(id, builder) {
      const patchState = {
        set: {},
        setIfMissing: {},
        append: {},
      };
      const patchApi = {
        set(fields) {
          patchState.set = { ...patchState.set, ...fields };
          return patchApi;
        },
        setIfMissing(fields) {
          patchState.setIfMissing = { ...patchState.setIfMissing, ...fields };
          return patchApi;
        },
        append(field, values) {
          patchState.append[field] = values;
          return patchApi;
        },
      };
      builder(patchApi);
      operations.push({ type: "patch", id, patchState });
      return this;
    },
    async commit() {
      if (state.documents) {
        operations.forEach(function (operation) {
          if (operation.type === "create" || operation.type === "createOrReplace") {
            state.documents.set(operation.document._id, deepClone(operation.document));
            return;
          }

          if (operation.type === "delete") {
            state.documents.delete(operation.id);
            return;
          }

          if (operation.type === "patch") {
            const current = deepClone(state.documents.get(operation.id) || {});
            const nextDocument = {
              ...current,
              ...deepClone(operation.patchState.setIfMissing),
              ...deepClone(operation.patchState.set),
            };

            Object.entries(operation.patchState.append).forEach(function ([field, values]) {
              nextDocument[field] = []
                .concat(Array.isArray(current[field]) ? current[field] : [])
                .concat(deepClone(values));
            });

            state.documents.set(operation.id, nextDocument);
          }
        });
      }

      state.lastTransaction = operations.slice();
      return { transactionId: "txn-1" };
    },
  };
}

export function createMemoryClient(initialDocuments) {
  const state = {
    documents: new Map(),
    lastTransaction: null,
  };

  Object.entries(initialDocuments || {}).forEach(function ([id, value]) {
    if (Array.isArray(value)) {
      value.forEach(function (document, index) {
        if (!document || typeof document !== "object") {
          return;
        }
        const documentId = document._id || document.id || `${id}-${index + 1}`;
        state.documents.set(documentId, deepClone({ ...document, _id: documentId }));
      });
      return;
    }
    state.documents.set(id, deepClone(value));
  });

  return {
    state,
    client: {
      async fetch(query, params) {
        if (
          query.includes(`*[_type == "therapist" && slug.current == $slug][0]`) &&
          params &&
          typeof params.slug === "string"
        ) {
          const match = Array.from(state.documents.values()).find(function (document) {
            if (document._type !== "therapist") {
              return false;
            }
            const current = document.slug && document.slug.current;
            return current === params.slug;
          });
          if (!match) {
            return null;
          }
          const cloned = deepClone(match);
          cloned.slug = params.slug;
          return cloned;
        }

        if (
          (query.includes(`*[_type == "therapist" && licenseNumber == $license][0]`) ||
            query.includes(`*[_type == "therapist" && licenseNumber match $license][0]`)) &&
          params &&
          typeof params.license === "string"
        ) {
          const rawLicense = params.license.replace(/^\*|\*$/g, "");
          const match = Array.from(state.documents.values()).find(function (document) {
            if (document._type !== "therapist") {
              return false;
            }
            const stored = String(document.licenseNumber || "");
            return stored === params.license || stored.includes(rawLicense);
          });
          return match ? deepClone(match) : null;
        }

        // Rate-limit count query for the recovery queue. Matches the
        // shape: count(*[_type == "therapistRecoveryRequest" && status == "pending" ...]).
        if (
          query.trim().startsWith("count(") &&
          query.includes('_type == "therapistRecoveryRequest"') &&
          query.includes('status == "pending"')
        ) {
          return Array.from(state.documents.values()).filter(function (document) {
            return document._type === "therapistRecoveryRequest" && document.status === "pending";
          }).length;
        }

        if (query.includes(`*[_type == "therapistRecoveryRequest"]`)) {
          return Array.from(state.documents.values()).filter(function (document) {
            return document._type === "therapistRecoveryRequest";
          });
        }

        if (query.includes(`*[_type == "therapistPortalRequest"]`)) {
          return Array.from(state.documents.values()).filter(function (document) {
            return document._type === "therapistPortalRequest";
          });
        }

        if (query.includes(`*[_type == "therapistCandidate"]`)) {
          return Array.from(state.documents.values()).filter(function (document) {
            return document._type === "therapistCandidate";
          });
        }

        if (query.includes(`*[_type == "therapistApplication"]`)) {
          return Array.from(state.documents.values()).filter(function (document) {
            return document._type === "therapistApplication";
          });
        }

        if (
          query.includes(
            `*[_type == "therapist" && claimStatus == "claimed" && lower(claimedByEmail) == $email]`,
          ) &&
          params &&
          typeof params.email === "string"
        ) {
          const match = Array.from(state.documents.values()).find(function (document) {
            if (document._type !== "therapist") {
              return false;
            }
            if (document.claimStatus !== "claimed") {
              return false;
            }
            return String(document.claimedByEmail || "").toLowerCase() === params.email;
          });
          return match ? deepClone(match) : null;
        }

        if (query.includes(`*[_type == "therapist"]`)) {
          return Array.from(state.documents.values()).filter(function (document) {
            return document._type === "therapist";
          });
        }

        if (query.includes(`*[_type == "therapistPublishEvent"]`)) {
          return Array.from(state.documents.values()).filter(function (document) {
            return document._type === "therapistPublishEvent";
          });
        }

        if (query.includes(`*[_type == "matchRequest"]`)) {
          return Array.from(state.documents.values()).filter(function (document) {
            return document._type === "matchRequest";
          });
        }

        if (query.includes(`*[_type == "matchOutcome"]`)) {
          return Array.from(state.documents.values()).filter(function (document) {
            return document._type === "matchOutcome";
          });
        }

        if (query.includes(`providerFieldObservation`)) {
          return Array.from(state.documents.values()).filter(function (document) {
            return document._type === "providerFieldObservation";
          });
        }

        if (query.includes(`therapistEngagementSummary`)) {
          const slugFilter = (params && params.slug) || null;
          return Array.from(state.documents.values())
            .filter(function (document) {
              if (document._type !== "therapistEngagementSummary") {
                return false;
              }
              if (slugFilter && document.therapistSlug !== slugFilter) {
                return false;
              }
              return true;
            })
            .sort(function (a, b) {
              return String(b.periodKey || "").localeCompare(String(a.periodKey || ""));
            });
        }

        return [];
      },
      async create(document) {
        const created = {
          ...deepClone(document),
          _createdAt: document._createdAt || document.requestedAt || new Date().toISOString(),
        };
        state.documents.set(created._id, created);
        return created;
      },
      async createOrReplace(document) {
        const stored = {
          ...deepClone(document),
          _createdAt: document._createdAt || new Date().toISOString(),
        };
        state.documents.set(stored._id, stored);
        return stored;
      },
      async getDocument(id) {
        return deepClone(state.documents.get(id) || null);
      },
      patch(id) {
        const pending = { set: {}, setIfMissing: {}, inc: {}, append: {}, unset: [] };
        const api = {
          set(fields) {
            pending.set = { ...pending.set, ...fields };
            return api;
          },
          setIfMissing(fields) {
            pending.setIfMissing = { ...pending.setIfMissing, ...fields };
            return api;
          },
          inc(fields) {
            Object.entries(fields || {}).forEach(function ([key, value]) {
              pending.inc[key] = (pending.inc[key] || 0) + Number(value || 0);
            });
            return api;
          },
          append(field, values) {
            pending.append[field] = values;
            return api;
          },
          unset(fields) {
            pending.unset = pending.unset.concat(Array.isArray(fields) ? fields : [fields]);
            return api;
          },
          async commit() {
            const current = deepClone(state.documents.get(id) || {});
            const next = {
              ...current,
              ...deepClone(pending.setIfMissing),
              ...deepClone(pending.set),
            };
            Object.entries(pending.inc).forEach(function ([key, value]) {
              next[key] = (Number(current[key]) || 0) + value;
            });
            Object.entries(pending.append).forEach(function ([key, values]) {
              next[key] = []
                .concat(Array.isArray(current[key]) ? current[key] : [])
                .concat(deepClone(values));
            });
            pending.unset.forEach(function (key) {
              delete next[key];
            });
            state.documents.set(id, next);
            return { _id: id };
          },
        };
        return api;
      },
      transaction() {
        return createTransactionSpy(state);
      },
    },
  };
}

export function createTestApiConfig() {
  return {
    projectId: "test-project",
    dataset: "test-dataset",
    apiVersion: "2026-04-02",
    token: "",
    adminUsername: "architect",
    adminPassword: "secret-pass",
    allowLegacyKey: false,
    adminKey: "",
    sessionTtlMs: 60000,
    allowedOrigins: [],
    sessionSecret: "test-secret",
    loginWindowMs: 60000,
    loginMaxAttempts: 5,
  };
}
