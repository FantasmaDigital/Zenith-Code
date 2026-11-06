import React, { useState } from 'react';
import { ArrowRight, ChevronDown, Lightbulb } from 'lucide-react';

/**
 * Guía de uso de un módulo. El contenido viene del manifest del módulo (campo `guide`),
 * así cada módulo nuevo trae su propia documentación sin tocar el panel.
 */
export default function ModuleGuide({ manifest, themeColor, onOpenSection }) {
  const guide = manifest?.guide;
  const [openFaq, setOpenFaq] = useState(null);

  if (!guide) {
    return (
      <div className="p-8 text-center text-[13px] text-zinc-500 bg-[#171717] border border-[#2e2e2e] rounded-md">
        Este módulo todavía no tiene guía de uso.
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-fadeIn pb-8">
      <div>
        <h1 className="text-xl font-medium tracking-tight text-zinc-100">Guía de uso · {manifest.name}</h1>
        <p className="text-sm text-zinc-400 mt-1 max-w-3xl leading-relaxed">{guide.summary}</p>
      </div>

      {guide.quick_start?.length > 0 && (
        <section className="p-4 bg-[#171717] border border-[#2e2e2e] rounded-md space-y-3">
          <h2 className="text-[13px] font-medium text-zinc-100">Primeros pasos</h2>
          <ol className="space-y-2">
            {guide.quick_start.map((step, i) => (
              <li key={i} className="flex gap-3 text-[13px] text-zinc-300 leading-relaxed">
                <span
                  className="w-5 h-5 shrink-0 rounded-full flex items-center justify-center text-[11px] font-medium text-black"
                  style={{ backgroundColor: themeColor }}
                >
                  {i + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Índice */}
      <nav className="flex flex-wrap gap-2" aria-label="Secciones de la guía">
        {guide.sections.map(sec => (
          <a
            key={sec.id}
            href={`#guide-${sec.id}`}
            className="px-2.5 py-1 rounded-md text-[12px] text-zinc-300 bg-[#1c1c1c] border border-[#2e2e2e] hover:border-[#3e3e3e] hover:text-zinc-100"
          >
            {sec.title}
          </a>
        ))}
        {guide.faq?.length > 0 && (
          <a href="#guide-faq" className="px-2.5 py-1 rounded-md text-[12px] text-zinc-300 bg-[#1c1c1c] border border-[#2e2e2e] hover:border-[#3e3e3e] hover:text-zinc-100">
            Preguntas frecuentes
          </a>
        )}
      </nav>

      {guide.sections.map(sec => (
        <section key={sec.id} id={`guide-${sec.id}`} className="scroll-mt-20 p-5 bg-[#171717] border border-[#2e2e2e] rounded-md space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-medium text-zinc-100">{sec.title}</h2>
              <p className="text-[13px] text-zinc-400 mt-1 leading-relaxed">{sec.what}</p>
            </div>
            {onOpenSection && (
              <button
                onClick={() => onOpenSection(sec.id)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-medium border border-[#3e3e3e] bg-[#232323] hover:bg-[#2e2e2e] text-zinc-200 shrink-0"
              >
                Ir a {sec.title.toLowerCase()} <ArrowRight size={13} />
              </button>
            )}
          </div>

          <ul className="space-y-1.5">
            {sec.how.map((item, i) => (
              <li key={i} className="flex gap-2.5 text-[13px] text-zinc-300 leading-relaxed">
                <span className="mt-2 w-1 h-1 rounded-full bg-zinc-500 shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>

          {sec.tips?.length > 0 && (
            <div className="p-3 rounded-md bg-[#1f1f1f] border border-[#2e2e2e] space-y-1">
              {sec.tips.map((tip, i) => (
                <p key={i} className="flex gap-2 text-[12px] text-zinc-400 leading-relaxed">
                  <Lightbulb size={13} className="mt-0.5 shrink-0" style={{ color: themeColor }} />
                  <span>{tip}</span>
                </p>
              ))}
            </div>
          )}
        </section>
      ))}

      {guide.faq?.length > 0 && (
        <section id="guide-faq" className="scroll-mt-20 space-y-2">
          <h2 className="text-base font-medium text-zinc-100">Preguntas frecuentes</h2>
          <div className="bg-[#171717] border border-[#2e2e2e] rounded-md divide-y divide-[#242424]">
            {guide.faq.map((item, i) => (
              <div key={i}>
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  aria-expanded={openFaq === i}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left text-[13px] text-zinc-200 hover:text-zinc-50"
                >
                  <span>{item.q}</span>
                  <ChevronDown size={14} className={`text-zinc-500 shrink-0 transition-transform ${openFaq === i ? '' : '-rotate-90'}`} />
                </button>
                {openFaq === i && <p className="px-4 pb-3 text-[13px] text-zinc-400 leading-relaxed">{item.a}</p>}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
