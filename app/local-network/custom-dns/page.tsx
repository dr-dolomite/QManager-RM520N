import CustomDnsComponent from "@/components/local-network/custom-dns/custom-dns";

// The route file is deliberately thin. The page header, the live band, the write
// card and the motion cascade all live in the shell, because this file is a
// SERVER component and a cascade root has to be a client one — which is why the
// header used to snap in while the rest of `/local-network/` faded.
//
// Same shape as the two sibling routes under `/local-network/`: page.tsx
// re-exports a shell and holds no markup of its own.
const CustomDnsPage = () => {
  return <CustomDnsComponent />;
};

export default CustomDnsPage;
