class ApiResponse {
    constructor(statusCode, data, message = "Success",length){
        this.statusCode = statusCode
        this.data = data
        this.message = message
        this.success = statusCode < 400
        this.length=length
    }
}

export { ApiResponse }