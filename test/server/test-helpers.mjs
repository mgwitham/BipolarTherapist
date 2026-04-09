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
      this.payload = body ? JSON.parse(body) : null;
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
    state.documents.set(id, deepClone(value));
  });

  return {
    state,
    client: {
      async fetch(query) {
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

        if (query.includes(`*[_type == "therapist"]`)) {
          return Array.from(state.documents.values()).filter(function (document) {
            return document._type === "therapist";
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
      async getDocument(id) {
        return deepClone(state.documents.get(id) || null);
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
