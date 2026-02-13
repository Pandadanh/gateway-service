import { Injectable, NestMiddleware, UnauthorizedException } from "@nestjs/common";
import { SECURITY_CONTANTS, verifyHmacSignature } from "@smashclub/common/"
import { Request, Response,NextFunction } from "express";
import { RoutesConfigService } from "src/config/routes.config.service";


@Injectable()
export class XUserSessionMiddleware implements NestMiddleware{
    constructor(
        private readonly routesConfigService: RoutesConfigService,
    ){}

    use(req: Request, res:Response, next: NextFunction){
        
        const header = req.header(SECURITY_CONTANTS.X_USER_SESSION_HEADER);

        if(!header){
            throw new UnauthorizedException('Missing X-UserSession header');
        }

        let decoded:string;

        try{
            decoded = Buffer.from(header,'base64').toString('utf8');
        }catch{
            throw new UnauthorizedException('Invalid Base64 in X-UserSession');
        }

        const [timestampStr, signature] = decoded.split('|');

        if(!timestampStr || !signature){
            throw new UnauthorizedException('Invalid X-UserSession format');
        }

        const timestamp = Number(timestampStr);

        if(!Number.isFinite(timestamp)){
            throw new UnauthorizedException('Invalid timestamp');
        }

        const now =Date.now();

        const timeCheck=Number(process.env.MAX_TIMESTAMP!);

        if(Math.abs(now-timestamp) > timeCheck){
            throw new UnauthorizedException('X-UserSession expired');
        }

        const rawData = `${timestamp}|${process.env.STATIC_APP_KEY}`;

        const valid = verifyHmacSignature(
            rawData,
            signature,
            process.env.HMAC_SHARED_SECRET!,
        );

         if (!valid) {
            throw new UnauthorizedException('Invalid X-UserSession signature');
        }

        return next();
    }
}