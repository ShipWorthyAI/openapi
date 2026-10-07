import ts from "#compiler";

export default {
  transformProperty(property, schemaObject, _options) {
    if (schemaObject.minLength === void 0) return;
    return property;
  },
};
