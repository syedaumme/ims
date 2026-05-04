const Joi = require('joi');

const signalSchema = Joi.object({
  componentId:   Joi.string().required(),
  componentType: Joi.string().valid('API', 'CACHE', 'RDBMS', 'QUEUE', 'NOSQL', 'MCP_HOST').required(),
  errorType:     Joi.string().required(),
  severity:      Joi.string().valid('P0', 'P1', 'P2', 'P3').required(),
  message:       Joi.string().optional(),
  payload:       Joi.object().optional(),
});

const rcaSchema = Joi.object({
  incidentStart:     Joi.date().iso().required(),
  incidentEnd:       Joi.date().iso().min(Joi.ref('incidentStart')).required(),
  rootCauseCategory: Joi.string()
    .valid('INFRA_FAILURE', 'CODE_BUG', 'CONFIG_ERROR', 'CAPACITY', 'THIRD_PARTY', 'UNKNOWN')
    .required(),
  fixApplied:      Joi.string().min(10).required(),
  preventionSteps: Joi.string().min(10).required(),
});

function validate(schema) {
  return (req, res, next) => {
    const { error } = schema.validate(req.body, { abortEarly: false });
    if (error) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.details.map((d) => d.message),
      });
    }
    next();
  };
}

module.exports = { validate, signalSchema, rcaSchema };
