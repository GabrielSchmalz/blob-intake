import type { Metadata } from "next";
import Pilot from "./pilot";
export const metadata:Metadata={title:"Blob Intake | Private file pilot",description:"Authenticated private-file acceptance pilot."};
export default function Page(){return <Pilot/>;}
