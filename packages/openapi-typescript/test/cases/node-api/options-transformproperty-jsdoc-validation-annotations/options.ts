import ts from "#compiler";

export default {
  transformProperty(property, schemaObject, _options) {
    const validationTags = [],
      schema = schemaObject;

    if (schema.minLength !== void 0) validationTags.push(`@minLength ${schema.minLength}`);
    if (schema.maxLength !== void 0) validationTags.push(`@maxLength ${schema.maxLength}`);
    if (schema.minimum !== void 0) validationTags.push(`@minimum ${schema.minimum}`);
    if (schema.maximum !== void 0) validationTags.push(`@maximum ${schema.maximum}`);
    if (schema.pattern !== void 0) validationTags.push(`@pattern ${schema.pattern}`);
    if (schema.format !== void 0) validationTags.push(`@format ${schema.format}`);

    if (validationTags.length > 0) {
      const newProperty = ts.factory.updatePropertySignature(
          property,
          property.modifiers,
          property.name,
          property.questionToken,
          property.type,
        ),
        jsDocText = `*
 * ${validationTags.join(`
 * `)}
 `;

      ts.addSyntheticLeadingComment(
        newProperty,
        ts.SyntaxKind.MultiLineCommentTrivia,
        jsDocText,
        !0,
      );

      return newProperty;
    }

    return property;
  },
};
