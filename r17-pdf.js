(function(){
  const BLUE=[28,88,164];
  const DARK=[37,53,72];
  const GREY=[111,126,145];
  const LIGHT=[247,249,252];
  const BORDER=[217,226,236];
  const GREEN=[28,142,77];

  function n(v){
    const x=Number(v);
    return Number.isFinite(x)?x:0;
  }

  function money(v){
    return new Intl.NumberFormat('es-AR',{
      style:'currency',
      currency:'ARS',
      maximumFractionDigits:0
    }).format(n(v));
  }

  function minutesText(value){
    const min=Math.max(0,Math.round(n(value)));
    const h=Math.floor(min/60);
    const m=min%60;
    if(h && m) return h+' h '+m+' min';
    if(h) return h+' h';
    return m+' min';
  }

  function dateText(iso){
    const d=iso ? new Date(iso) : new Date();
    return new Intl.DateTimeFormat('es-AR',{
      day:'2-digit',
      month:'2-digit',
      year:'numeric'
    }).format(d);
  }

  function sanitizeFilePart(value){
    return String(value||'servicio')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g,'')
      .replace(/[^a-zA-Z0-9]+/g,'_')
      .replace(/^_+|_+$/g,'')
      .slice(0,70) || 'servicio';
  }

  function itemsOf(record){
    if(Array.isArray(record.items)) return record.items;
    const snap=record.snapshot||{};
    return Array.isArray(snap.items)?snap.items:[];
  }

  function normalize(record){
    const snap=record.snapshot||{};
    const prices=snap.prices||{};
    const items=itemsOf(record);

    const oneWayKm=
      record.one_way_km!==undefined
        ? n(record.one_way_km)
        : n(snap.one_way_km);

    const laborMinutes=
      record.labor_minutes!==undefined
        ? n(record.labor_minutes)
        : n(snap.labor_minutes);

    const roundTripMinutes=
      record.round_trip_minutes!==undefined
        ? n(record.round_trip_minutes)
        : n(snap.round_trip_minutes);

    const employedMinutes=
      snap.total_employed_minutes!==undefined
        ? n(snap.total_employed_minutes)
        : laborMinutes+roundTripMinutes;

    const itemTotal=items.reduce((sum,item)=>{
      return sum+n(item.qty)*n(item.price);
    },0);

    const cash=
      record.total_cash_rounded!==undefined
        ? n(record.total_cash_rounded)
        : n(prices.total_cash_rounded);

    const visitRounded=
      prices.visit_labor_rounded!==undefined
        ? n(prices.visit_labor_rounded)
        : Math.max(0,cash-itemTotal);

    const serviceIvaPercent=
      prices.service_iva_percent!==undefined
        ? n(prices.service_iva_percent)
        : (record.iva_percent!==undefined
            ? n(record.iva_percent)
            : (prices.iva_percent!==undefined?n(prices.iva_percent):21));

    const transferSurchargePercent=
      prices.transfer_surcharge_percent!==undefined
        ? n(prices.transfer_surcharge_percent)
        : 12;

    const transferBase=
      record.transfer_base!==undefined
        ? n(record.transfer_base)
        : (prices.transfer_base!==undefined
            ? n(prices.transfer_base)
            : cash);

    const invoice=
      record.total_invoice!==undefined
        ? n(record.total_invoice)
        : (prices.total_invoice!==undefined
            ? n(prices.total_invoice)
            : transferBase*(1+serviceIvaPercent/100));

    const ivaAmount=
      record.iva_amount!==undefined
        ? n(record.iva_amount)
        : (prices.iva_amount!==undefined
            ? n(prices.iva_amount)
            : Math.max(0,invoice-transferBase));

    const taxModel=String(snap.tax_model||prices.tax_model||'legacy').trim();
    const mixedTax=taxModel==='mixed_v2' || Array.isArray(prices.iva_breakdown);
    const ivaBreakdown=Array.isArray(prices.iva_breakdown) && prices.iva_breakdown.length
      ? prices.iva_breakdown.map(x=>({percent:n(x.percent),base:n(x.base),amount:n(x.amount)}))
      : [{percent:serviceIvaPercent,base:transferBase,amount:ivaAmount}];

    const rawCustomerType=String(
      record.customer_type ||
      snap.customer_type ||
      'particular'
    ).trim().toLowerCase();

    const customerType=
      rawCustomerType==='industria'
        ? 'industria'
        : ((rawCustomerType==='consorcio' || rawCustomerType==='edificio')
            ? 'consorcio'
            : 'particular');

    const address=
      record.customer_address ||
      snap.customer_address ||
      'Ubicación registrada';

    return {
      id:record.id||'',
      mode:record.mode||snap.mode||'quote',
      createdAt:record.created_at||new Date().toISOString(),
      address,
      oneWayKm,
      employedMinutes,
      items,
      visitRounded,
      cash,
      transferBase,
      transferSurchargePercent,
      ivaPercent:serviceIvaPercent,
      serviceIvaPercent,
      ivaBreakdown,
      ivaAmount,
      invoice,
      mixedTax,
      customerType
    };
  }

  async function logoDataUrl(){
    try{
      const response=await fetch(
        'https://automatizacionpioca.github.io/pioca-gps/logo-pioca.png',
        {cache:'force-cache'}
      );
      if(!response.ok) throw new Error('logo');
      const blob=await response.blob();
      return await new Promise((resolve,reject)=>{
        const reader=new FileReader();
        reader.onload=()=>resolve(reader.result);
        reader.onerror=reject;
        reader.readAsDataURL(blob);
      });
    }catch(e){
      return null;
    }
  }

  function fileName(record){
    const r=normalize(record);
    const d=new Date(r.createdAt);
    const pad=v=>String(v).padStart(2,'0');
    const fecha=pad(d.getDate())+'-'+pad(d.getMonth()+1)+'-'+d.getFullYear();
    return fecha+'_'+sanitizeFilePart(r.address)+'.pdf';
  }

  async function build(record){
    if(!window.jspdf || !window.jspdf.jsPDF){
      throw new Error('No se pudo cargar el generador de PDF.');
    }

    const {jsPDF}=window.jspdf;
    const doc=new jsPDF({
      orientation:'portrait',
      unit:'mm',
      format:'a4',
      compress:true
    });

    const r=normalize(record);
    const margin=18;
    const pageW=210;
    const pageH=297;
    const contentW=pageW-margin*2;
    let y=18;

    function setText(rgb){
      doc.setTextColor(rgb[0],rgb[1],rgb[2]);
    }

    function ensureSpace(h){
      if(y+h>pageH-18){
        doc.addPage();
        y=18;
      }
    }

    function divider(){
      doc.setDrawColor(BORDER[0],BORDER[1],BORDER[2]);
      doc.setLineWidth(.35);
      doc.line(margin,y,pageW-margin,y);
    }

    function infoRow(label,value,opts={}){
      ensureSpace(opts.height||14);
      const labelW=78;
      doc.setFont('helvetica','normal');
      doc.setFontSize(12.5);
      setText(GREY);
      doc.text(label,margin,y);

      doc.setFont('helvetica','bold');
      doc.setFontSize(opts.valueSize||12.5);
      setText(opts.blue?BLUE:DARK);

      const lines=doc.splitTextToSize(String(value),contentW-labelW-3);
      doc.text(lines,margin+labelW,y,{align:'left'});
      const used=Math.max(8,lines.length*6.2);
      y+=used+5;
      divider();
      y+=5;
    }

    const logo=await logoDataUrl();

    if(logo){
      try{
        doc.addImage(logo,'PNG',margin,y,28,28,undefined,'FAST');
      }catch(e){}
    }else{
      doc.setFont('helvetica','bold');
      doc.setFontSize(23);
      setText(BLUE);
      doc.text('piOca®',margin,y+16);
    }

    doc.setFont('helvetica','bold');
    doc.setFontSize(20);
    setText(DARK);
    doc.text('Resumen de servicio',margin+36,y+11);

    doc.setFont('helvetica','normal');
    doc.setFontSize(11.5);
    setText(GREY);
    doc.text('piOca® | abre y cierra siempre',margin+36,y+18);

    doc.setFont('helvetica','normal');
    doc.setFontSize(11);
    doc.text('Fecha: '+dateText(r.createdAt),pageW-margin,y+26,{align:'right'});

    y+=38;

    const locationLabel=
      r.mode==='service'
        ? 'Ubicación aproximada del cliente'
        : 'Ubicación';

    doc.setFont('helvetica','bold');
    doc.setFontSize(12.5);
    const addressLines=doc.splitTextToSize(r.address,contentW-14);
    const addressH=Math.max(7,addressLines.length*6.3);
    const infoBoxH=45+addressH;
    const boxTop=y;

    doc.setFillColor(LIGHT[0],LIGHT[1],LIGHT[2]);
    doc.setDrawColor(BORDER[0],BORDER[1],BORDER[2]);
    doc.roundedRect(margin,boxTop,contentW,infoBoxH,4,4,'FD');

    let infoY=boxTop+11;

    doc.setFont('helvetica','normal');
    doc.setFontSize(11.5);
    setText(GREY);
    doc.text(locationLabel,margin+7,infoY);

    infoY+=8;

    doc.setFont('helvetica','bold');
    doc.setFontSize(12.5);
    setText(DARK);
    doc.text(addressLines,margin+7,infoY);

    infoY+=addressH+8;

    // El resumen para el cliente no muestra kilómetros ni distancia recorrida.
    // La distancia queda disponible únicamente en el historial/detalle interno.
    doc.setFont('helvetica','normal');
    doc.setFontSize(12);
    setText(GREY);
    doc.text('Tiempo empleado en el servicio',margin+7,infoY);
    doc.setFont('helvetica','bold');
    setText(DARK);
    doc.text(minutesText(r.employedMinutes),pageW-margin-7,infoY,{align:'right'});

    y=boxTop+infoBoxH+14;

    doc.setFont('helvetica','bold');
    doc.setFontSize(15);
    setText(BLUE);
    doc.text('Detalle',margin,y);
    y+=9;

    infoRow(
      'Costo de visita y mano de obra',
      money(r.visitRounded),
      {blue:true,height:17}
    );

    if(r.items.length){
      ensureSpace(12+r.items.length*13);
      doc.setFont('helvetica','bold');
      doc.setFontSize(12.5);
      setText(DARK);
      doc.text('Accesorios / repuestos',margin,y);
      y+=7;

      r.items.forEach(item=>{
        const qty=Math.max(1,n(item.qty));
        const desc=String(item.desc||'Ítem');
        const cashTotal=qty*n(item.price);
        const itemIva=(r.mixedTax && item.iva_percent!==undefined) ? n(item.iva_percent) : r.ivaPercent;
        const factBase=cashTotal*(1+r.transferSurchargePercent/100);
        const factFinal=factBase*(1+itemIva/100);

        doc.setFont('helvetica','normal');
        doc.setFontSize(12);
        setText(GREY);
        const detail=(qty!==1?qty+' × ':'')+desc;
        const detailLines=doc.splitTextToSize(detail,100);
        doc.text(detailLines,margin,y);

        doc.setFont('helvetica','bold');
        doc.setFontSize(11.5);
        setText(DARK);
        if(r.customerType==='consorcio'){
          doc.text(money(factFinal),pageW-margin-7,y,{align:'right'});
        }else if(r.customerType==='industria'){
          doc.text(money(factBase)+' + IVA '+itemIva.toLocaleString('es-AR',{maximumFractionDigits:2})+'%',pageW-margin-7,y,{align:'right'});
        }else{
          doc.text(money(cashTotal)+' ef.',pageW-margin-7,y,{align:'right'});
          doc.setFont('helvetica','normal');doc.setFontSize(9.5);setText(GREY);
          doc.text(money(factBase)+' + IVA '+itemIva.toLocaleString('es-AR',{maximumFractionDigits:2})+'%',pageW-margin-7,y+5,{align:'right'});
        }

        y+=Math.max(12,detailLines.length*6.2+6);
        divider();
        y+=4;
      });

      y+=3;
    }

    function drawTaxRows(boxY,startOffset){
      let yy=boxY+startOffset;
      r.ivaBreakdown.forEach(row=>{
        doc.setFont('helvetica','normal');
        doc.setFontSize(11.5);
        setText(GREY);
        doc.text('IVA ('+row.percent.toLocaleString('es-AR',{maximumFractionDigits:2})+'%)',margin+7,yy);
        doc.setFont('helvetica','bold');
        setText(DARK);
        doc.text(money(row.amount),pageW-margin-7,yy,{align:'right'});
        yy+=12;
      });
      return yy;
    }

    if(r.customerType==='particular'){
      const taxRows=Math.max(1,r.ivaBreakdown.length);
      const invoiceH=35+taxRows*12;
      ensureSpace(33+invoiceH);

      doc.setFillColor(LIGHT[0],LIGHT[1],LIGHT[2]);
      doc.setDrawColor(BORDER[0],BORDER[1],BORDER[2]);
      doc.roundedRect(margin,y,contentW,21,4,4,'FD');
      doc.setFont('helvetica','normal');doc.setFontSize(13);setText(GREY);
      doc.text('Descuento por pago efectivo',margin+7,y+13);
      doc.setFont('helvetica','bold');doc.setFontSize(17);setText(GREEN);
      doc.text(money(r.cash),pageW-margin-7,y+13.2,{align:'right'});
      y+=27;

      doc.setFillColor(255,255,255);doc.setDrawColor(193,208,226);doc.setLineWidth(.45);
      doc.roundedRect(margin,y,contentW,invoiceH,4,4,'FD');
      doc.setFont('helvetica','normal');doc.setFontSize(12.5);setText(GREY);
      doc.text('Facturado sin IVA',margin+7,y+13);
      doc.setFont('helvetica','bold');doc.setFontSize(13.5);setText(DARK);
      doc.text(money(r.transferBase),pageW-margin-7,y+13,{align:'right'});
      let finalY=drawTaxRows(y,27);
      doc.setDrawColor(BORDER[0],BORDER[1],BORDER[2]);
      doc.line(margin+7,finalY-6,pageW-margin-7,finalY-6);
      doc.setFont('helvetica','normal');doc.setFontSize(12.5);setText(GREY);
      doc.text('Precio final IVA incluido',margin+7,finalY+5);
      doc.setFont('helvetica','bold');doc.setFontSize(16);setText(BLUE);
      doc.text(money(r.invoice),pageW-margin-7,finalY+5,{align:'right'});

    }else if(r.customerType==='consorcio'){
      ensureSpace(34);
      doc.setFillColor(255,255,255);doc.setDrawColor(193,208,226);doc.setLineWidth(.45);
      doc.roundedRect(margin,y,contentW,28,4,4,'FD');
      doc.setFont('helvetica','normal');doc.setFontSize(12.5);setText(GREY);
      doc.text('Total final IVA incluido',margin+7,y+17);
      doc.setFont('helvetica','bold');doc.setFontSize(17);setText(BLUE);
      doc.text(money(r.invoice),pageW-margin-7,y+17,{align:'right'});

    }else{
      const taxRows=Math.max(1,r.ivaBreakdown.length);
      const boxH=35+taxRows*12;
      ensureSpace(boxH+8);
      doc.setFillColor(255,255,255);doc.setDrawColor(193,208,226);doc.setLineWidth(.45);
      doc.roundedRect(margin,y,contentW,boxH,4,4,'FD');
      doc.setFont('helvetica','normal');doc.setFontSize(12.5);setText(GREY);
      doc.text('Subtotal facturado',margin+7,y+13);
      doc.setFont('helvetica','bold');doc.setFontSize(13.5);setText(DARK);
      doc.text(money(r.transferBase),pageW-margin-7,y+13,{align:'right'});
      let finalY=drawTaxRows(y,27);
      doc.setDrawColor(BORDER[0],BORDER[1],BORDER[2]);
      doc.line(margin+7,finalY-6,pageW-margin-7,finalY-6);
      doc.setFont('helvetica','normal');doc.setFontSize(12.5);setText(GREY);
      doc.text('Total con IVA',margin+7,finalY+5);
      doc.setFont('helvetica','bold');doc.setFontSize(16);setText(BLUE);
      doc.text(money(r.invoice),pageW-margin-7,finalY+5,{align:'right'});
    }

    doc.setFont('helvetica','normal');
    doc.setFontSize(10.5);
    setText(GREY);
    doc.text(
      'Resumen emitido por piOca®',
      pageW/2,
      pageH-10,
      {align:'center'}
    );

    return doc.output('blob');
  }

  const SHARE_MESSAGE=
    'Hola\n\nTe adjuntamos el resumen del servicio solicitado, con la información y los valores correspondientes.';

  async function copyMessage(){
    try{
      if(navigator.clipboard && navigator.clipboard.writeText){
        await navigator.clipboard.writeText(SHARE_MESSAGE);
        return true;
      }
    }catch(e){}

    try{
      const ta=document.createElement('textarea');
      ta.value=SHARE_MESSAGE;
      ta.setAttribute('readonly','');
      ta.style.position='fixed';
      ta.style.opacity='0';
      document.body.appendChild(ta);
      ta.select();
      const ok=document.execCommand('copy');
      document.body.removeChild(ta);
      return !!ok;
    }catch(e){
      return false;
    }
  }

  async function openPdf(record){
    const w=window.open('','_blank');
    try{
      const blob=await build(record);
      const url=URL.createObjectURL(blob);
      if(w){
        w.location.href=url;
      }else{
        window.location.href=url;
      }
      setTimeout(()=>URL.revokeObjectURL(url),60000);
    }catch(e){
      if(w) w.close();
      throw e;
    }
  }

  async function downloadPdf(record){
    const blob=await build(record);
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;
    a.download=fileName(record);
    a.style.display='none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
    return true;
  }

  async function sharePdf(record){
    const messageCopied=await copyMessage();
    const blob=await build(record);
    const name=fileName(record);
    const file=new File([blob],name,{type:'application/pdf'});

    if(
      navigator.share &&
      (!navigator.canShare || navigator.canShare({files:[file]}))
    ){
      await navigator.share({
        title:'Resumen de servicio piOca®',
        text:SHARE_MESSAGE,
        files:[file]
      });
      return {shared:true,messageCopied,name};
    }

    await downloadPdf(record);
    return {shared:false,downloaded:true,messageCopied,name};
  }

  window.PiocaPDF={
    build,
    openPdf,
    downloadPdf,
    sharePdf,
    copyMessage,
    message:SHARE_MESSAGE,
    fileName,
    normalize
  };
})();
