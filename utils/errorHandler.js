import { ApiError } from "./ApiError.js";

const errorHandler = (err, req, res, next) => {
    if (err instanceof ApiError) {
      return res.status(err.statusCode).json({
        statusCode: err.statusCode,
        message: err.message,
        data: null,
        success: err.success,
        errors: err.errors,
        fieldErrors: err.fieldErrors, 
      });
    }
  
    return res.status(500).json({
      statusCode: 500,
      message: "Internal Server Error",
      data: null,
      success: false,
    });
  };
  
  export { errorHandler };
  