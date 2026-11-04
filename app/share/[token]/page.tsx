import { SharedPurchase } from "@/src/ui/components/SharedPurchase";
export const metadata = { title:"Shared purchase", robots:{index:false,follow:false} };
export default async function Page({params}:{params:Promise<{token:string}>}) {return <SharedPurchase token={(await params).token}/>;}
