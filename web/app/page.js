import Reveal from "@/components/Reveal";
import NavBar from "@/components/NavBar";
import FilmHero from "@/components/FilmHero";
import Hero from "@/components/Hero";
import Ticker from "@/components/Ticker";
import PullQuote from "@/components/PullQuote";
import AttestationPanel from "@/components/AttestationPanel";
import Steps from "@/components/Steps";
import TrustStrip from "@/components/TrustStrip";
import FeatureGrid from "@/components/FeatureGrid";
import PartnerStrip from "@/components/PartnerStrip";
import Faq from "@/components/Faq";
import CtaPanel from "@/components/CtaPanel";
import Footer from "@/components/Footer";

export default function Home() {
  return (
    <>
      <Reveal />
      <NavBar />
      <main>
        <FilmHero />
        <Hero />
        <Ticker />
        <PullQuote />
        <AttestationPanel />
        <Steps />
        <TrustStrip />
        <FeatureGrid />
        <PartnerStrip />
        <Faq />
        <CtaPanel />
      </main>
      <Footer />
    </>
  );
}
